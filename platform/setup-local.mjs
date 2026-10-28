import { randomBytes } from 'node:crypto';
import { access,writeFile,unlink } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
const base=new URL('./',import.meta.url);
const files=[new URL('.env',base),new URL('backend/.env',base),new URL('frontend/.env',base)];
const created=[];
try {
  for(const file of files){
    if(await access(file).then(()=>true,()=>false))throw new Error('Настройки уже существуют: '+fileURLToPath(file)+'. Ничего не перезаписано.');
  }
  const password=randomBytes(24).toString('hex'),secret=randomBytes(32).toString('hex');
  const port=Number(process.env.LOCAL_DB_PORT || 54329);
  if(!Number.isInteger(port) || port<1024 || port>65535)throw new Error('LOCAL_DB_PORT должен быть от 1024 до 65535');
  const contents=[
    `DB_PASSWORD=${password}\nJWT_SECRET=${secret}\nLOCAL_DB_PORT=${port}\n`,
    `DATABASE_URL=postgresql://affiliate:${password}@127.0.0.1:${port}/affiliate\nJWT_SECRET=${secret}\nHOST=127.0.0.1\nPORT=4000\nUPLOADS_DIR=./uploads\nPUBLIC_URL=http://127.0.0.1:3000\nOWNER_EMAIL=\nOWNER_NAME=Owner\nWORKSPACE_NAME=Local workspace\n`,
    'VITE_API_URL=\n',
  ];
  for(let i=0;i<files.length;i++){
    await writeFile(files[i],contents[i],{flag:'wx',mode:0o600});created.push(files[i]);
  }
  console.log('Локальные настройки созданы с правами 600. Секреты не выводятся. Следуйте platform/README.md.');
} catch(error){
  for(const file of created)await unlink(file).catch(()=>{});
  console.error(error.message);process.exitCode=1;
}
