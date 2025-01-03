// ------------------ overlay.js ------------------

// 1) Cпочатку додаємо стилі через <style> (щоби не робити окремий .css)
const styleEl = document.createElement('style');
styleEl.textContent = `
  /* Скидаємо відступи, робимо фон чорним */
  html, body {
    margin: 0;
    padding: 0;
    width: 100%;
    height: 100%;
    background: #000;
  }

  /* Основне відео */
  #mainVideo {
    width: 100%;
    height: 100%;
    object-fit: cover;  
    background: #000;
    display: block;
  }

  /* Прозорий оверлей, що блокує взаємодію з основним відео */
  #overlay {
    position: absolute;
    top: 0; 
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0);
    z-index: 999;
    cursor: pointer;
  }

  /* Рекламне відео */
  .ad-video {
    position: absolute;
    top: 0; 
    left: 0;
    width: 100%;
    height: 100%;
    object-fit: cover;
    background: #000;
    z-index: 1000; 
  }

  /* Прозорий «клік-оверлей» над рекламним відео (для ClickThrough) */
  .click-through-overlay {
    position: absolute;
    top: 0;
    left: 0;
    width: 100%;
    height: 100%;
    background: rgba(0, 0, 0, 0);
    z-index: 1001;
    cursor: pointer;
  }

  /* Кнопка "Skip" */
  .skip-button {
    position: absolute;
    bottom: 20px;   
    right: 20px;    
    padding: 10px 15px;
    background-color: rgba(0,0,0,0.7);
    color: #fff;
    font-weight: bold;
    border: 1px solid #999;
    border-radius: 5px;
    cursor: not-allowed;
    opacity: 0.7;
    z-index: 1002; 
  }
  .skip-button.active {
    cursor: pointer;
    opacity: 1;
  }

  /* Кнопка "Mute" */
  .mute-button {
    position: absolute;
    top: 20px;
    right: 20px;
    padding: 10px 15px;
    background-color: rgba(0,0,0,0.7);
    color: #fff;
    font-weight: bold;
    border: 1px solid #999;
    border-radius: 5px;
    cursor: pointer;
    opacity: 0.8;
    z-index: 1002; 
  }
`;
document.head.appendChild(styleEl);


// 2) Основна логіка при завантаженні DOM
document.addEventListener('DOMContentLoaded', () => {
  const vastUrl   = 'VAST.xml'; // або де у вас лежить цей VAST
  const mainVideo = document.getElementById('mainVideo');
  const overlay   = document.getElementById('overlay');

  // Параметри реклами, що зчитуємо з VAST
  let adUrl            = null;  // MediaFile
  let clickThroughUrl  = null;  // ClickThrough
  let skipDelay        = 15;    // Можливість скіпнути (сек.)
  let errorUrl         = null;  // Error-трекінг (один)
  let impressionUrls   = [];    // Масив усіх Impression

  let adStarted        = false; // Щоби не запускати вдруге
  let impressionSent   = false; // Щоби не надсилати Impression повторно

  // -------------------- ФУНКЦІЇ ТРЕКІНГУ ------------------------
  /**
   * Викликає трекер (через fetch або <img>).
   * У продакшені це часто роблять маленьким пікселем <img>.
   */
  function trackUrl(url) {
    if (!url) return;
    fetch(url).catch(e => {
      console.error('Tracking error', e, url);
    });
  }

  /**
   * Парсить time "HH:MM:SS" -> секунди (наприклад, "00:00:15" -> 15).
   */
  function parseTime(str) {
    const parts = str.split(':').map(x => parseInt(x, 10));
    if (parts.length === 3) {
      return parts[0]*3600 + parts[1]*60 + parts[2];
    }
    return 15; // fallback
  }

  // -------------------- ЗАВАНТАЖУЄМО VAST ------------------------
  fetch(vastUrl)
    .then(response => response.text())
    .then(xmlString => {
      const parser  = new DOMParser();
      const vastXml = parser.parseFromString(xmlString, 'text/xml');
      
      // Error
      const errorNode = vastXml.querySelector('Error');
      if (errorNode) {
        errorUrl = errorNode.textContent.trim();
      }

      // Impression (їх може бути кілька)
      const impressionNodes = vastXml.querySelectorAll('Impression');
      impressionUrls = [...impressionNodes].map(n => n.textContent.trim());

      // Зчитуємо Linear, щоб знайти skipoffset
      const linearNode = vastXml.querySelector('Linear[skipoffset]');
      if (linearNode) {
        const skipStr = linearNode.getAttribute('skipoffset'); // "00:00:15"
        if (skipStr) skipDelay = parseTime(skipStr);
      }

      // MediaFile (посилання на відео реклами)
      const mediaFileNode = vastXml.querySelector('MediaFile');
      if (mediaFileNode) {
        adUrl = mediaFileNode.textContent.trim();
      }

      // ClickThrough
      const clickThroughNode = vastXml.querySelector('ClickThrough');
      if (clickThroughNode) {
        clickThroughUrl = clickThroughNode.textContent.trim();
      }

    })
    .catch(err => {
      console.error('Помилка завантаження VAST:', err);
    });


  // -------------------- Клік по overlay ------------------------
  overlay.addEventListener('click', () => {
    if (adStarted) return;  // Реклама вже запущена
    adStarted = true;

    // Зупиняємо головне відео
    mainVideo.pause();

    // Якщо немає URL реклами - приберемо оверлей, дамо дивитися основне
    if (!adUrl) {
      overlay.remove();
      return;
    }

    // 1) Створюємо рекламне відео
    const adVideo = document.createElement('video');
    adVideo.classList.add('ad-video');
    adVideo.src = adUrl;
    adVideo.autoplay = true;
    adVideo.controls = false;
    adVideo.muted = false;
    adVideo.playsInline = true;
    document.body.appendChild(adVideo);

    // 1.1) Якщо буде помилка в рекламі => викликаємо Error-трекер
    adVideo.addEventListener('error', () => {
      console.warn('Ad video error happened!');
      trackUrl(errorUrl);
      // Видаляємо рекламу, повертаємося до основного
      removeAdElements(adVideo, skipBtn, muteBtn, clickOverlay);
      overlay.remove();
      mainVideo.play().catch(e => console.error(e));
    });

    // 2) Створюємо прозорий оверлей для ClickThrough (якщо є URL)
    let clickOverlay = null;
    if (clickThroughUrl) {
      clickOverlay = document.createElement('div');
      clickOverlay.classList.add('click-through-overlay');
      document.body.appendChild(clickOverlay);

      clickOverlay.addEventListener('click', () => {
        // Спочатку можна також викликати <ClickTracking>, якщо буде в VAST
        // trackUrl('https:// ... ClickTracking ...');

        // Потім відкриваємо ClickThrough
        window.open(clickThroughUrl, '_blank');
      });
    }

    // 3) Кнопка Skip
    const skipBtn = document.createElement('div');
    skipBtn.classList.add('skip-button');
    skipBtn.textContent = `Пропустити (${skipDelay})`;
    document.body.appendChild(skipBtn);

    // 4) Кнопка Mute
    const muteBtn = document.createElement('div');
    muteBtn.classList.add('mute-button');
    muteBtn.textContent = 'Mute';
    document.body.appendChild(muteBtn);

    // 5) Логіка таймера для Skip
    let timeLeft = skipDelay;
    const intervalId = setInterval(() => {
      timeLeft--;
      skipBtn.textContent = `Пропустити (${timeLeft})`;
      if (timeLeft <= 0) {
        clearInterval(intervalId);
        skipBtn.textContent = 'Пропустити';
        skipBtn.classList.add('active');
        skipBtn.style.cursor = 'pointer';
      }
    }, 1000);

    // 5.1) Клік по Skip
    skipBtn.addEventListener('click', () => {
      if (!skipBtn.classList.contains('active')) return; // ще не можна
      removeAdElements(adVideo, skipBtn, muteBtn, clickOverlay);
      overlay.remove();
      mainVideo.play().catch(e => console.error(e));
    });

    // 6) Клік по Mute
    muteBtn.addEventListener('click', () => {
      if (!adVideo.muted) {
        adVideo.muted = true;
        muteBtn.textContent = 'Unmute';
      } else {
        adVideo.muted = false;
        muteBtn.textContent = 'Mute';
      }
    });

    // 7) Коли реклама *почала фактично грати* => Impression
    adVideo.addEventListener('playing', () => {
      if (!impressionSent) {
        impressionSent = true; // Щоби не відправляти двічі
        impressionUrls.forEach(url => trackUrl(url));
      }
    });

    // 8) Коли реклама закінчилася
    adVideo.addEventListener('ended', () => {
      removeAdElements(adVideo, skipBtn, muteBtn, clickOverlay);
      overlay.remove();
      mainVideo.play().catch(e => console.error(e));
    });
  });


  // Допоміжна функція для видалення рекламних елементів
  function removeAdElements(adVideoEl, skipBtnEl, muteBtnEl, clickOverlayEl) {
    if (adVideoEl && document.body.contains(adVideoEl)) {
      document.body.removeChild(adVideoEl);
    }
    if (skipBtnEl && document.body.contains(skipBtnEl)) {
      document.body.removeChild(skipBtnEl);
    }
    if (muteBtnEl && document.body.contains(muteBtnEl)) {
      document.body.removeChild(muteBtnEl);
    }
    if (clickOverlayEl && document.body.contains(clickOverlayEl)) {
      document.body.removeChild(clickOverlayEl);
    }
  }
});
