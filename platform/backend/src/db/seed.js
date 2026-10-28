import 'dotenv/config';
import pg from 'pg';
import bcrypt from 'bcryptjs';
import { nanoid } from 'nanoid';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createInterface } from 'node:readline/promises';
import { Writable } from 'node:stream';

export async function seedOwner({ connectionString=process.env.DATABASE_URL,email=process.env.OWNER_EMAIL,password=process.env.OWNER_PASSWORD,name=process.env.OWNER_NAME || 'Owner',workspaceName=process.env.WORKSPACE_NAME || 'Local workspace' }={}) {
  email=String(email || '').trim().toLowerCase();
  if(!connectionString)throw new Error('Задайте DATABASE_URL');
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))throw new Error('Задайте корректный OWNER_EMAIL');
  if(typeof password!=='string' || password.length<12 || Buffer.byteLength(password)>72)throw new Error('OWNER_PASSWORD: минимум 12 символов, максимум 72 байта');
  if(!String(name).trim() || !String(workspaceName).trim())throw new Error('Укажите имя владельца и команды');
  const hash=await bcrypt.hash(password,10);
  const pool=new pg.Pool({connectionString});let client;
  try {
    client=await pool.connect();await client.query('BEGIN');
    await client.query("SELECT pg_advisory_xact_lock(hashtext(current_database()),hashtext(current_schema() || ':bananabun-owner'))");
    const {rows:[existing]}=await client.query('SELECT (SELECT COUNT(*) FROM users) + (SELECT COUNT(*) FROM workspaces) AS count');
    if(Number(existing.count)!==0)throw new Error('Установка уже содержит данные: владелец и пароли не изменены');
    const workspaceId='ws_'+nanoid(20),userId='usr_'+nanoid(20);
    await client.query('INSERT INTO workspaces(id,name) VALUES($1,$2)',[workspaceId,String(workspaceName).trim().slice(0,255)]);
    await client.query("INSERT INTO users(id,workspace_id,email,name,password_hash,role) VALUES($1,$2,$3,$4,$5,'owner')",[userId,workspaceId,email,String(name).trim().slice(0,255),hash]);
    await client.query('COMMIT');
    return {workspaceId,userId};
  } catch(error){if(client)await client.query('ROLLBACK').catch(()=>{});throw error;}
  finally {client?.release();await pool.end();}
}

async function prompt(question,secret=false){
  const output=secret ? new Writable({write(_chunk,_encoding,done){done();}}) : process.stdout;
  const reader=createInterface({input:process.stdin,output,terminal:true});
  try {
    if(secret)process.stdout.write(question);
    return await reader.question(secret ? '' : question);
  } finally {reader.close();if(secret)process.stdout.write('\n');}
}
async function cli(){
  const options={};
  if(process.stdin.isTTY){
    if(!process.env.OWNER_EMAIL)options.email=await prompt('Email владельца: ');
    if(!process.env.OWNER_PASSWORD)options.password=await prompt('Пароль (не отображается, минимум 12 символов): ',true);
  }
  await seedOwner(options);
  console.log('Первый владелец создан. Удалите OWNER_PASSWORD из окружения, если задавали его.');
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  cli().catch(error=>{
    // Do not print connection strings, hashes, password values or pg error details.
    console.error(error.code ? 'Не удалось создать владельца: проверьте миграции и доступ к базе.' : error.message);
    process.exitCode=1;
  });
}
