/* Трекер Keitaro для ручного шаблона — копия платформенного
 * app/static/landing_tracker/keitaro.js с одной правкой: комплекты берутся
 * не из window.KEITARO_OFFERS, а из window.FA_PRODUCT.bundles, который
 * платформа вписывает в <head> при заливе. Ключ комплекта — "b<номер>"
 * (b0, b1, …), его же ставит assets/fa-fill.js в data-product кнопок выбора.
 *
 * Сборка ссылки (buildKeitaroOfferUrl, все sub_id, параметры формы) — байт в
 * байт как в оригинале: это касса.
 *
 * Ссылка строится от window.location.origin, поэтому лендинг обязан быть залит
 * как local в тот же поток Keitaro. Иначе кнопка ведёт в никуда.
 */
(function () {
  var OFFER_URL = '{offer}';
  if (!OFFER_URL || OFFER_URL.indexOf('{') !== -1) {
    OFFER_URL = '#';
  }

  // Конфиг товара сюда не пишется. Его ставит заливка в index.html, до
  // подключения этого файла: один товар — одно место. В папках рекламных
  // кампаний конфиг лежал и здесь, и в разметке, копии разъехались, и в трекер
  // от надувного замка уходило имя садовой беседки.
  // Комплекты и товар — из FA_PRODUCT. Запись комплекта — в той же форме, что
  // писала заливка в KEITARO_OFFERS: id (offer_id), price, compare (старая
  // цена), qty, label (подпись комплекта; как у заливки — количество).
  var FA = window.FA_PRODUCT || {};
  var FA_BUNDLES = Array.isArray(FA.bundles) ? FA.bundles : [];
  var FA_PHOTOS = Array.isArray(FA.photos) ? FA.photos : [];
  window.KEITARO_PRODUCT = window.KEITARO_PRODUCT || {};
  // Название для оффера — короткое общее (как у конкурента: t, product_title и source_id —
  // «Cric hydraulique rouleur 3 T extra-plat»); у старой карточки без short_title — полное, как раньше.
  if (!window.KEITARO_PRODUCT.title && (FA.short_title || FA.title)) {
    window.KEITARO_PRODUCT.title = String(FA.short_title || FA.title);
  }
  if (!window.KEITARO_PRODUCT.sourceId && FA.short_title) {
    window.KEITARO_PRODUCT.sourceId = String(FA.short_title);
  }
  if (!window.KEITARO_PRODUCT.trackingSlug && FA.tracking_slug) {
    window.KEITARO_PRODUCT.trackingSlug = String(FA.tracking_slug);
  }
  if (!window.KEITARO_PRODUCT.imageDefault && FA_PHOTOS[0]) {
    window.KEITARO_PRODUCT.imageDefault = String(FA_PHOTOS[0]);
  }
  window.KEITARO_OFFERS = {};
  for (var fi = 0; fi < FA_BUNDLES.length; fi++) {
    var fb = FA_BUNDLES[fi] || {};
    var fq = fb.qty === undefined || fb.qty === null || fb.qty === '' ? '1' : String(fb.qty);
    window.KEITARO_OFFERS['b' + fi] = {
      id: fb.offer_id === undefined || fb.offer_id === null ? '' : String(fb.offer_id),
      price: fb.price === undefined || fb.price === null ? '' : String(fb.price),
      compare: fb.old_price === undefined || fb.old_price === null ? '' : String(fb.old_price),
      qty: fq,
      // Цена и старая цена — строкой, как их видит покупатель и как шлёт конкурент
      // («19,99 €»), подпись комплекта — «1 cric hydraulique» / «2 × cric hydraulique + 1 gratuit».
      // Всё это готовит fa-fill.js (он подключён раньше); нет его полей — сырые значения, как раньше.
      priceText: fb.fa_price ? String(fb.fa_price) : '',
      compareText: fb.fa_compare !== undefined && fb.fa_compare !== null ? String(fb.fa_compare) : '',
      label: fb.fa_label ? String(fb.fa_label) : fq
    };
  }

  /* Первый комплект в конфиге — он же запасной вариант выбора.
   *
   * Запасным вариантом раньше было слово `single`, и это была ошибка: ключ
   * комплекта считается от количества (`single` только при одной штуке, иначе
   * `pack2`, `pack3`), поэтому у карточки с комплектами «2 шт» и «3 шт» ключа
   * `single` нет вовсе. KEITARO_SELECTED оставался undefined, и кнопка покупки
   * падала на offer.id — на живом трафике, молча, без единого заказа.
   */
  function firstOfferKey() {
    var keys = Object.keys(window.KEITARO_OFFERS || {});
    return keys.length ? keys[0] : '';
  }

  window.KEITARO_SELECTED =
    window.KEITARO_SELECTED || window.KEITARO_OFFERS[firstOfferKey()] || {};

  function resolveAssetUrl(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    try {
      return new URL(path, window.location.href).href;
    } catch (e) {
      return path;
    }
  }

  //: Последний осознанный выбор покупателя. Класс на кнопке страница может
  //: перебить своим кодом, эту переменную — нет.
  var CHOSEN = '';

  function getSelectedProductId() {
    try {
      if (CHOSEN && window.KEITARO_OFFERS[CHOSEN]) return CHOSEN;
      var selected = document.querySelector('.product-choice.is-selected');
      if (selected) {
        var pid = selected.getAttribute('data-product');
        if (pid && window.KEITARO_OFFERS[pid]) return pid;
      }
      var v = localStorage.getItem('ck_product');
      if (v && window.KEITARO_OFFERS[v]) return v;
      var legacy = localStorage.getItem('sl_product_mode');
      // Легаси-ключи старых лендов — только если такой комплект в конфиге есть.
      if (legacy === 'A' && window.KEITARO_OFFERS.single) return 'single';
      if (legacy === 'B' && window.KEITARO_OFFERS.pack3) return 'pack3';
      if (legacy && window.KEITARO_OFFERS[legacy]) return legacy;
    } catch (e) {}
    return firstOfferKey();
  }

  function syncSelectedOffer() {
    // Откат — на первый существующий комплект, а не на слово `single`: его в
    // конфиге может не быть вовсе (см. firstOfferKey). Пустой объект в конце —
    // чтобы buildKeitaroOfferUrl не падал на странице совсем без комплектов:
    // упавший обработчик — это кнопка покупки, которая ничего не делает.
    window.KEITARO_SELECTED =
      window.KEITARO_OFFERS[getSelectedProductId()] ||
      window.KEITARO_OFFERS[firstOfferKey()] ||
      {};
  }

  function resolveImageFromPath(path) {
    if (!path) return '';
    if (/^https?:\/\//i.test(path)) return path;
    var probe = document.createElement('img');
    probe.src = path;
    if (probe.src) return probe.src;
    return resolveAssetUrl(path);
  }

  function getCurrentProductImageSrc() {
    var hero = document.querySelector('.hero-image');
    if (hero && hero.src) {
      return hero.src;
    }
    var swatch = document.querySelector(
      '.color-picker__swatch.is-active, .color-picker__option.is-active, .choice--swatch.is-active'
    );
    if (swatch) {
      var swImg = swatch.querySelector('img');
      if (swImg && swImg.src) return swImg.src;
      var dataImage = swatch.getAttribute('data-image');
      if (dataImage) return resolveImageFromPath(dataImage);
    }
    var cfg = window.LANDING_PRODUCT || window.KEITARO_PRODUCT || {};
    return resolveImageFromPath(cfg.imageDefault || '');
  }

  window.getKeitaroProductImageSrc = getCurrentProductImageSrc;

  //: Значение параметра ссылки. Незаполненное поле уезжает пустым, а не
  //: словом «undefined»: пустой sub_id в отчёте читается как пустой, а
  //: «undefined» — как значение, и ищут потом несуществующий комплект.
  function text(value) {
    return value === undefined || value === null ? '' : String(value);
  }

  //: Количество для формы заказа рекламодателя — числом: акция «2+1» уходит
  //: как «3». Сама «2+1» остаётся в подписи комплекта (label).
  function qtyTotal(value) {
    var s = text(value).replace(/\s+/g, '');
    if (!/^\d+(\+\d+)+$/.test(s)) return text(value);
    return String(s.split('+').reduce(function (sum, part) { return sum + parseInt(part, 10); }, 0));
  }

  window.buildKeitaroOfferUrl = function (withFormPrefill) {
    syncSelectedOffer();
    // Ссылку собираем при любой раскладке конфига: кнопка покупки — не то
    // место, где можно позволить себе исключение. Пустой offer_id виден в
    // отчёте сразу, а упавший обработчик выглядит как мёртвая кнопка.
    var offer = window.KEITARO_SELECTED || {};
    var cfg = window.KEITARO_PRODUCT || {};
    var imageUrl = getCurrentProductImageSrc();
    var url = new URL('/', window.location.origin);
    var currentParams = new URLSearchParams(window.location.search);
    currentParams.forEach(function (value, key) {
      url.searchParams.set(key, value);
    });
    url.searchParams.set('sub_id_11', '');
    url.searchParams.set('_lp', '1');
    url.searchParams.set('offer_id', text(offer.id));
    url.searchParams.set('sub_id_16', text(cfg.trackingSlug));
    url.searchParams.set('sub_id_17', text(offer.label));
    url.searchParams.set('sub_id_18', imageUrl);
    // id посетителя PostHog — по нему конверсия Keitaro связывается с его кликами
    var fa = window.FA_ANALYTICS;
    if (fa && typeof fa.distinctId === 'function') url.searchParams.set('sub_id_23', text(fa.distinctId()));
    url.searchParams.set('i', imageUrl);
    url.searchParams.set('image', imageUrl);
    url.searchParams.set('img', imageUrl);
    url.searchParams.set('product_image', imageUrl);
    url.searchParams.set('adv2', imageUrl);
    url.searchParams.set('t', text(cfg.title));
    url.searchParams.set('p', text(offer.priceText || offer.price));
    url.searchParams.set('cp', text(offer.priceText ? offer.compareText : offer.compare));
    url.searchParams.set('source_id', text(cfg.sourceId));
    url.searchParams.set('quantity', qtyTotal(offer.qty));
    url.searchParams.set('qty', qtyTotal(offer.qty));
    url.searchParams.set('product_name', text(offer.label));
    url.searchParams.set('product_title', text(cfg.title));
    url.searchParams.set('name', text(offer.label));

    if (withFormPrefill) {
      var phone =
        typeof window.formatPhoneWithCode === 'function'
          ? window.formatPhoneWithCode(localStorage.form_phone || '')
          : localStorage.form_phone || '';
      url.searchParams.set('sub10', localStorage.form_firstname || '');
      url.searchParams.set('adv3', localStorage.form_lastname || '');
      url.searchParams.set(
        'sub4',
        (localStorage.form_email || '').replace(/ /g, '')
      );
      url.searchParams.set('sub8', phone);
      url.searchParams.set('sub7', localStorage.form_address || '');
      url.searchParams.set('sub6', localStorage.form_city || '');
      url.searchParams.set(
        'sub3',
        (localStorage.form_zipcode || '').replace(/ /g, '')
      );
    }

    return url.toString();
  };

  window.buildOfferUrl = window.buildKeitaroOfferUrl;
  window.slGetCheckoutUrl = function () {
    return window.buildKeitaroOfferUrl(false);
  };

  /* Переключение комплекта — работа этого файла, а не страницы.
   *
   * Отметку `.is-selected` читает getSelectedProductId выше: по ней собирается
   * ссылка на оффер, то есть по ней считаются деньги. Ставить её раньше должен
   * был код самой страницы, и это ни разу не было записано договором: движок
   * отметку только читал. На снятом лендинге агент завёл свой словарь
   * комплектов и назвал в нём ключ `bundle3` — а в разметке и в KEITARO_OFFERS
   * стоял `pack3`. Его обработчик не находил ключа, откатывался к первому
   * комплекту, и кнопка «3 штуки» не переключала ничего: покупатель выбирал
   * тройку, а в трекер уходило «1 шт, 19.99».
   *
   * Поэтому здесь три вещи, и каждая закрывает свой способ проиграть чужому
   * коду:
   *  - слушаем на document в фазе перехвата, а не на самих кнопках: страница
   *    вправе перерисовать их, и подвешенные к узлам обработчики умрут вместе
   *    с узлами;
   *  - помним выбор переменной, а не только классом: свой словарь у страницы
   *    может остаться, но на цену и количество он уже не влияет;
   *  - возвращаем отметку в конец очереди задач: обработчик страницы отработает
   *    после нашего и перебьёт класс своим откатом, и последнее слово должно
   *    остаться за движком.
   * Своя логика страницы (главное фото, суммы в корзине) при этом продолжает
   * работать: мы трогаем ровно класс и aria-состояние.
   */
  var CHOICE_SELECTOR = '.product-choice[data-product]';

  function markChoice(pid) {
    var choices = document.querySelectorAll(CHOICE_SELECTOR);
    for (var i = 0; i < choices.length; i++) {
      var on = choices[i].getAttribute('data-product') === pid;
      choices[i].classList.toggle('is-selected', on);
      if (choices[i].hasAttribute('aria-pressed')) {
        choices[i].setAttribute('aria-pressed', on ? 'true' : 'false');
      }
    }
  }

  function chooseProduct(pid) {
    if (!pid) return;
    CHOSEN = window.KEITARO_OFFERS[pid] ? pid : CHOSEN;
    try {
      localStorage.setItem('ck_product', pid);
    } catch (e) {}
    markChoice(pid);
    syncSelectedOffer();
  }

  document.addEventListener(
    'click',
    function (ev) {
      var node = ev.target;
      var el = node && node.closest ? node.closest(CHOICE_SELECTOR) : null;
      if (!el) return;
      var pid = el.getAttribute('data-product');
      chooseProduct(pid);
      setTimeout(function () {
        markChoice(pid);
        syncSelectedOffer();
      }, 0);
    },
    true
  );

  function bindChoices() {
    var choices = document.querySelectorAll(CHOICE_SELECTOR);
    if (!choices.length) return;
    for (var i = 0; i < choices.length; i++) {
      var pid = choices[i].getAttribute('data-product');
      var offer = pid ? window.KEITARO_OFFERS[pid] : null;
      if (offer && offer.id) {
        choices[i].setAttribute('data-offer-id', offer.id);
      }
    }
    // Ни одного выбранного — выбираем первый: страница без отметки собирала бы
    // ссылку по запасному варианту, а покупатель видел бы список без выбора.
    if (!document.querySelector('.product-choice.is-selected')) {
      choices[0].classList.add('is-selected');
    }
    syncSelectedOffer();
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', bindChoices);
  } else {
    bindChoices();
  }
})();
