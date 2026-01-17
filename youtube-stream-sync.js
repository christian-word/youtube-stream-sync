/**
 * YouTube Stream Sync Library
 * Версія: 1.0.0
 * Ліцензія: MIT
 * 
 * Бібліотека для створення 24/7 YouTube трансляцій з автоматичною синхронізацією
 * 
 * @example
 * const stream = new YouTubeStreamSync({
 *   container: '#stream-player',
 *   playlistUrl: 'https://example.com/playlist.json',
 *   theme: 'dark',
 *   autoplay: false
 * });
 */

(function(window) {
  'use strict';

  // Версія бібліотеки
  const VERSION = '1.0.0';

  /**
   * Головний клас бібліотеки
   */
  class YouTubeStreamSync {
    
    constructor(options = {}) {
      // Налаштування за замовчуванням
      this.options = {
        container: '#youtube-stream-sync',
        playlistUrl: null,
        theme: 'light', // 'light' | 'dark' | 'custom'
        autoplay: false,
        showSchedule: true,
        showControls: true,
        locale: 'uk-UA',
        timezone: 0,
        quality: 'default',
        customStyles: null,
        onReady: null,
        onPlay: null,
        onVideoChange: null,
        onError: null,
        ...options
      };

      // Валідація
      if (!this.options.playlistUrl) {
        throw new Error('YouTubeStreamSync: playlistUrl є обов\'язковим параметром');
      }

      // Внутрішні змінні
      this.player = null;
      this.currentVideoIndex = 0;
      this.broadcastProgram = null;
      this.timers = {
        sync: null,
        progress: null,
        remaining: null
      };
      this.watchedVideos = this._loadWatchedVideos();
      
      // Ініціалізація
      this.init();
    }

    /**
     * Ініціалізація бібліотеки
     */
    async init() {
      try {
        // Перевірка контейнера
        this.container = document.querySelector(this.options.container);
        if (!this.container) {
          throw new Error(`Контейнер "${this.options.container}" не знайдено`);
        }

        // Завантаження YouTube API
        await this._loadYouTubeAPI();

        // Створення інтерфейсу
        this._createUI();

        // Застосування стилів
        this._applyStyles();

        // Завантаження плейлиста
        await this._loadPlaylist();

        // Ініціалізація плеєра
        this._initPlayer();

        // Callback готовності
        if (typeof this.options.onReady === 'function') {
          this.options.onReady(this);
        }

      } catch (error) {
        this._handleError(error);
      }
    }

    /**
     * Завантаження YouTube IFrame API
     */
    _loadYouTubeAPI() {
      return new Promise((resolve, reject) => {
        // Якщо API вже завантажено
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }

        // Якщо скрипт вже додано
        if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          window.onYouTubeIframeAPIReady = resolve;
          return;
        }

        // Завантажуємо API
        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => reject(new Error('Не вдалося завантажити YouTube API'));
        
        window.onYouTubeIframeAPIReady = resolve;
        document.head.appendChild(script);
      });
    }

    /**
     * Створення HTML структури
     */
    _createUI() {
      const uniqueId = 'ytss-' + Math.random().toString(36).substr(2, 9);
      
      this.container.innerHTML = `
        <div class="ytss-wrapper" data-theme="${this.options.theme}">
          <!-- Плеєр -->
          <div class="ytss-player-container">
            <div class="ytss-player-wrapper">
              <div id="${uniqueId}-player" class="ytss-player"></div>
              
              <!-- LIVE індикатор -->
              <div class="ytss-live-indicator" style="display: none;">
                <span class="ytss-pulse-dot"></span>
                <span>LIVE</span>
              </div>
              
              <!-- Індикатор завантаження -->
              <div class="ytss-loading" style="display: none;">
                <div class="ytss-spinner"></div>
                <span>Завантаження...</span>
              </div>
              
              <!-- Оверлей старту -->
              <div class="ytss-start-overlay">
                <div class="ytss-start-content">
                  <div class="ytss-start-icon">▶</div>
                  <h3>Готові дивитися?</h3>
                  <p>Натисніть "Відтворити" щоб розпочати трансляцію</p>
                  <button class="ytss-btn ytss-btn-primary ytss-start-btn">
                    Відтворити
                  </button>
                </div>
              </div>
            </div>
            
            <!-- Прогрес-бар -->
            <div class="ytss-progress-container">
              <div class="ytss-progress-bar"></div>
            </div>
            
            <!-- Контроли -->
            ${this.options.showControls ? this._createControls() : ''}
          </div>
          
          <!-- Статус -->
          <div class="ytss-status-bar">
            <div class="ytss-status-item">
              <span class="ytss-status-label">Статус:</span>
              <span class="ytss-status-value" id="${uniqueId}-status">Готується...</span>
            </div>
            <div class="ytss-status-item">
              <span class="ytss-status-label">Час:</span>
              <span class="ytss-status-value" id="${uniqueId}-time">--:--:--</span>
            </div>
          </div>
          
          <!-- Розклад -->
          ${this.options.showSchedule ? `
            <div class="ytss-schedule">
              <div class="ytss-schedule-header">
                <h3>Розклад</h3>
                <button class="ytss-btn ytss-btn-small ytss-scroll-btn" style="display: none;">
                  До поточного
                </button>
              </div>
              <ul class="ytss-schedule-list" id="${uniqueId}-schedule"></ul>
            </div>
          ` : ''}
          
          <!-- Тост -->
          <div class="ytss-toast"></div>
        </div>
      `;

      // Зберігаємо посилання на елементи
      this.elements = {
        playerId: uniqueId + '-player',
        status: document.getElementById(uniqueId + '-status'),
        time: document.getElementById(uniqueId + '-time'),
        schedule: document.getElementById(uniqueId + '-schedule'),
        liveIndicator: this.container.querySelector('.ytss-live-indicator'),
        loading: this.container.querySelector('.ytss-loading'),
        progressBar: this.container.querySelector('.ytss-progress-bar'),
        toast: this.container.querySelector('.ytss-toast'),
        startOverlay: this.container.querySelector('.ytss-start-overlay'),
        startBtn: this.container.querySelector('.ytss-start-btn'),
        playBtn: this.container.querySelector('.ytss-play-btn'),
        qualitySelect: this.container.querySelector('.ytss-quality-select'),
        timezoneSelect: this.container.querySelector('.ytss-timezone-select'),
        scrollBtn: this.container.querySelector('.ytss-scroll-btn')
      };

      // Прив'язка подій
      this._bindEvents();
    }

    /**
     * Створення контролів
     */
    _createControls() {
      return `
        <div class="ytss-controls">
          <button class="ytss-btn ytss-play-btn">
            ▶ Відтворити
          </button>
          
          <select class="ytss-select ytss-quality-select">
            <option value="default">Авто якість</option>
            <option value="small">360p</option>
            <option value="medium">480p</option>
            <option value="large">720p</option>
            <option value="hd1080">1080p</option>
          </select>
          
          <select class="ytss-select ytss-timezone-select">
            <option value="0">Поточний час</option>
            <option value="3600">+1 година</option>
            <option value="7200">+2 години</option>
            <option value="10800">+3 години</option>
            <option value="-3600">-1 година</option>
            <option value="-7200">-2 години</option>
            <option value="-10800">-3 години</option>
          </select>
        </div>
      `;
    }

    /**
     * Прив'язка подій
     */
    _bindEvents() {
      // Кнопка старту на оверлеї
      if (this.elements.startBtn) {
        this.elements.startBtn.addEventListener('click', () => {
          this.play();
        });
      }

      // Кнопка відтворення
      if (this.elements.playBtn) {
        this.elements.playBtn.addEventListener('click', () => {
          this.play();
        });
      }

      // Зміна якості
      if (this.elements.qualitySelect) {
        this.elements.qualitySelect.addEventListener('change', () => {
          this.setQuality(this.elements.qualitySelect.value);
        });
      }

      // Зміна часового поясу
      if (this.elements.timezoneSelect) {
        this.elements.timezoneSelect.addEventListener('change', () => {
          this.options.timezone = parseInt(this.elements.timezoneSelect.value);
          this.play(); // Перезапуск з новим часом
        });
      }

      // Скрол до поточного
      if (this.elements.scrollBtn) {
        this.elements.scrollBtn.addEventListener('click', () => {
          this._scrollToCurrent();
        });
      }
    }

    /**
     * Застосування стилів
     */
    _applyStyles() {
      // Перевірка чи стилі вже додані
      if (document.getElementById('ytss-styles')) return;

      const styleId = 'ytss-styles';
      const style = document.createElement('style');
      style.id = styleId;
      style.textContent = this._getDefaultStyles();
      document.head.appendChild(style);

      // Кастомні стилі
      if (this.options.customStyles) {
        const customStyle = document.createElement('style');
        customStyle.textContent = this.options.customStyles;
        document.head.appendChild(customStyle);
      }
    }

    /**
     * Стилі за замовчуванням
     */
    _getDefaultStyles() {
      return `
        .ytss-wrapper {
          font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
          max-width: 100%;
          margin: 0 auto;
        }

        .ytss-wrapper * {
          box-sizing: border-box;
        }

        /* Теми */
        .ytss-wrapper[data-theme="light"] {
          --ytss-bg: #ffffff;
          --ytss-text: #2B2D42;
          --ytss-border: #e5e7eb;
          --ytss-primary: #D4AF37;
        }

        .ytss-wrapper[data-theme="dark"] {
          --ytss-bg: #18181B;
          --ytss-text: #EFEFEF;
          --ytss-border: #27272A;
          --ytss-primary: #9146FF;
        }

        /* Плеєр */
        .ytss-player-container {
          background: var(--ytss-bg);
          border-radius: 12px;
          overflow: hidden;
          box-shadow: 0 4px 12px rgba(0,0,0,0.1);
        }

        .ytss-player-wrapper {
          position: relative;
          padding-bottom: 56.25%;
          height: 0;
        }

        .ytss-player {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
        }

        /* LIVE індикатор */
        .ytss-live-indicator {
          position: absolute;
          top: 12px;
          left: 12px;
          background: rgba(239, 68, 68, 0.9);
          color: white;
          padding: 6px 12px;
          border-radius: 20px;
          font-size: 11px;
          font-weight: 700;
          z-index: 10;
          display: flex;
          align-items: center;
          gap: 6px;
        }

        .ytss-pulse-dot {
          width: 8px;
          height: 8px;
          background: white;
          border-radius: 50%;
          animation: ytss-pulse 1.5s infinite;
        }

        @keyframes ytss-pulse {
          0%, 100% { opacity: 1; }
          50% { opacity: 0.3; }
        }

        /* Завантаження */
        .ytss-loading {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: rgba(0,0,0,0.8);
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 16px;
          z-index: 100;
          color: white;
        }

        .ytss-spinner {
          width: 50px;
          height: 50px;
          border: 4px solid rgba(255,255,255,0.3);
          border-top: 4px solid var(--ytss-primary);
          border-radius: 50%;
          animation: ytss-spin 1s linear infinite;
        }

        @keyframes ytss-spin {
          0% { transform: rotate(0deg); }
          100% { transform: rotate(360deg); }
        }

        /* Оверлей старту */
        .ytss-start-overlay {
          position: absolute;
          top: 0;
          left: 0;
          width: 100%;
          height: 100%;
          background: linear-gradient(135deg, rgba(45, 106, 79, 0.95), rgba(69, 123, 157, 0.95));
          display: flex;
          align-items: center;
          justify-content: center;
          z-index: 50;
          transition: opacity 0.5s;
        }

        .ytss-start-overlay.hidden {
          opacity: 0;
          pointer-events: none;
        }

        .ytss-start-content {
          text-align: center;
          color: white;
          padding: 40px;
        }

        .ytss-start-icon {
          font-size: 4rem;
          margin-bottom: 20px;
          opacity: 0.9;
        }

        .ytss-start-content h3 {
          font-size: 1.8rem;
          margin-bottom: 12px;
        }

        .ytss-start-content p {
          font-size: 1rem;
          opacity: 0.9;
          margin-bottom: 24px;
        }

        /* Прогрес-бар */
        .ytss-progress-container {
          height: 4px;
          background: rgba(0,0,0,0.1);
          cursor: pointer;
        }

        .ytss-progress-bar {
          height: 100%;
          background: var(--ytss-primary);
          width: 0;
          transition: width 0.1s linear;
        }

        /* Контроли */
        .ytss-controls {
          display: flex;
          gap: 12px;
          padding: 16px;
          flex-wrap: wrap;
        }

        .ytss-btn {
          padding: 10px 20px;
          border-radius: 8px;
          border: none;
          font-weight: 600;
          cursor: pointer;
          transition: all 0.3s;
          font-size: 14px;
        }

        .ytss-btn-primary {
          background: var(--ytss-primary);
          color: white;
        }

        .ytss-btn-primary:hover {
          opacity: 0.9;
          transform: translateY(-1px);
        }

        .ytss-btn-small {
          padding: 6px 12px;
          font-size: 12px;
        }

        .ytss-select {
          padding: 10px 14px;
          border-radius: 8px;
          border: 1px solid var(--ytss-border);
          background: var(--ytss-bg);
          color: var(--ytss-text);
          cursor: pointer;
          font-size: 14px;
          flex: 1;
          min-width: 150px;
        }

        /* Статус */
        .ytss-status-bar {
          display: flex;
          gap: 20px;
          padding: 12px 16px;
          background: var(--ytss-bg);
          border-top: 1px solid var(--ytss-border);
          font-size: 13px;
        }

        .ytss-status-label {
          color: var(--ytss-text);
          opacity: 0.7;
          margin-right: 6px;
        }

        .ytss-status-value {
          color: var(--ytss-text);
          font-weight: 600;
        }

        /* Розклад */
        .ytss-schedule {
          margin-top: 20px;
        }

        .ytss-schedule-header {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 12px;
        }

        .ytss-schedule-header h3 {
          margin: 0;
          color: var(--ytss-text);
          font-size: 1.2rem;
        }

        .ytss-schedule-list {
          list-style: none;
          padding: 0;
          margin: 0;
          max-height: 400px;
          overflow-y: auto;
        }

        .ytss-schedule-item {
          background: var(--ytss-bg);
          padding: 12px 16px;
          margin-bottom: 8px;
          border-radius: 8px;
          border: 2px solid transparent;
          transition: all 0.3s;
        }

        .ytss-schedule-item.current {
          border-color: var(--ytss-primary);
          background: rgba(212, 175, 55, 0.1);
        }

        .ytss-schedule-item.played {
          opacity: 0.5;
        }

        /* Тост */
        .ytss-toast {
          position: fixed;
          bottom: 20px;
          left: 50%;
          transform: translateX(-50%);
          background: var(--ytss-bg);
          color: var(--ytss-text);
          padding: 12px 24px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.2);
          opacity: 0;
          pointer-events: none;
          transition: opacity 0.3s;
          z-index: 10000;
        }

        .ytss-toast.show {
          opacity: 1;
        }

        /* Адаптивність */
        @media (max-width: 768px) {
          .ytss-controls {
            flex-direction: column;
          }
          
          .ytss-select {
            width: 100%;
          }
        }
      `;
    }

    /**
     * Завантаження плейлиста
     */
    async _loadPlaylist() {
      try {
        const response = await fetch(this.options.playlistUrl);
        if (!response.ok) throw new Error('Не вдалося завантажити плейлист');
        
        const data = await response.json();
        let totalTime = 0;
        
        data.programSchedule.forEach(video => {
          video.startTime = totalTime;
          totalTime += video.duration;
        });
        
        this.broadcastProgram = data;
        this._updateStatus('Готовий');
        
        if (this.options.showSchedule) {
          this._renderSchedule();
        }

      } catch (error) {
        throw new Error(`Помилка завантаження плейлиста: ${error.message}`);
      }
    }

    /**
     * Ініціалізація YouTube плеєра
     */
    _initPlayer() {
      this.player = new YT.Player(this.elements.playerId, {
        height: '100%',
        width: '100%',
        playerVars: {
          playsinline: 1,
          rel: 0,
          modestbranding: 1
        },
        events: {
          onReady: () => this._onPlayerReady(),
          onStateChange: (e) => this._onPlayerStateChange(e)
        }
      });
    }

    /**
     * Плеєр готовий
     */
    _onPlayerReady() {
      if (this.options.autoplay) {
        this.play();
      }
    }

    /**
     * Зміна стану плеєра
     */
    _onPlayerStateChange(event) {
      const state = event.data;

      if (state === YT.PlayerState.BUFFERING) {
        this.elements.loading.style.display = 'flex';
      } else {
        this.elements.loading.style.display = 'none';
      }

      if (state === YT.PlayerState.PLAYING) {
        this.elements.liveIndicator.style.display = 'flex';
        
        if (typeof this.options.onPlay === 'function') {
          this.options.onPlay(this.currentVideoIndex);
        }
      }

      if (state === YT.PlayerState.ENDED) {
        this._playNextVideo();
      }
    }

    /**
     * Публічні методи API
     */

    // Відтворення
    play() {
      if (!this.broadcastProgram) {
        this._showToast('Плейлист ще не завантажено');
        return;
      }

      // Ховаємо оверлей
      if (this.elements.startOverlay) {
        this.elements.startOverlay.classList.add('hidden');
      }

      this._clearTimers();
      this._startBroadcast();
    }

    // Пауза
    pause() {
      if (this.player && this.player.pauseVideo) {
        this.player.pauseVideo();
      }
    }

    // Зупинка
    stop() {
      if (this.player && this.player.stopVideo) {
        this.player.stopVideo();
      }
      this._clearTimers();
    }

    // Зміна якості
    setQuality(quality) {
      if (this.player && this.player.setPlaybackQuality) {
        this.player.setPlaybackQuality(quality);
        this._showToast(`Якість змінено: ${quality}`);
      }
    }

    // Отримання поточного відео
    getCurrentVideo() {
      if (!this.broadcastProgram) return null;
      return this.broadcastProgram.programSchedule[this.currentVideoIndex];
    }

    // Знищення instance
    destroy() {
      this._clearTimers();
      if (this.player && this.player.destroy) {
        this.player.destroy();
      }
      this.container.innerHTML = '';
    }

    /**
     * Внутрішні методи
     */

    _startBroadcast() {
      const offset = this.options.timezone;
      const now = Date.now() / 1000;
      const startTime = new Date(this.broadcastProgram.broadcastStartTime).getTime() / 1000;
      const elapsed = now - startTime + offset;

      const videoData = this._findCurrentVideo(elapsed);

      if (videoData.video) {
        this.player.loadVideoById({
          videoId: videoData.video.videoId,
          startSeconds: Math.max(0, videoData.seconds),
          suggestedQuality: this.options.quality
        });
        this.currentVideoIndex = videoData.index;
      }

      this._startSyncTimer(startTime);
      this._highlightCurrent();
    }

    _findCurrentVideo(elapsed) {
      if (elapsed < 0) {
        return {
          video: this.broadcastProgram.programSchedule[0],
          seconds: 0,
          index: 0
        };
      }

      for (let i = 0; i < this.broadcastProgram.programSchedule.length; i++) {
        const video = this.broadcastProgram.programSchedule[i];
        if (elapsed >= video.startTime && elapsed < video.startTime + video.duration) {
          return {
            video: video,
            seconds: elapsed - video.startTime,
            index: i
          };
        }
      }

      return { video: null, seconds: 0, index: 0 };
    }

    _startSyncTimer(startTime) {
      this.timers.sync = setInterval(() => {
        const now = Date.now() / 1000;
        const elapsed = now - startTime + this.options.timezone;
        
        // Оновлення часу
        const time = new Date((startTime + elapsed) * 1000);
        this._updateTime(time.toLocaleTimeString(this.options.locale));

        // Синхронізація
        const videoData = this._findCurrentVideo(elapsed);
        
        if (videoData.index !== this.currentVideoIndex) {
          this.currentVideoIndex = videoData.index;
          this.player.loadVideoById({
            videoId: videoData.video.videoId,
            startSeconds: Math.max(0, videoData.seconds),
            suggestedQuality: this.options.quality
          });
          
          this._highlightCurrent();
          
          if (typeof this.options.onVideoChange === 'function') {
            this.options.onVideoChange(this.currentVideoIndex, videoData.video);
          }
        }

        // Корекція швидкості
        const drift = this.player.getCurrentTime() - videoData.seconds;
        if (Math.abs(drift) > 1) {
          this.player.setPlaybackRate(drift > 0 ? 0.9 : 1.1);
        } else {
          this.player.setPlaybackRate(1);
        }
      }, 1000);

      // Прогрес-бар
      this.timers.progress = setInterval(() => {
        if (this.player && this.player.getDuration) {
          const current = this.player.getCurrentTime();
          const duration = this.player.getDuration();
          if (duration > 0) {
            this.elements.progressBar.style.width = (current / duration * 100) + '%';
          }
        }
      }, 500);
    }

    _playNextVideo() {
      const video = this.getCurrentVideo();
      if (video) {
        this._markAsWatched(video.videoId);
      }

      this.currentVideoIndex++;
      
      if (this.currentVideoIndex < this.broadcastProgram.programSchedule.length) {
        const next = this.broadcastProgram.programSchedule[this.currentVideoIndex];
        this.player.loadVideoById({
          videoId: next.videoId,
          startSeconds: 0,
          suggestedQuality: this.options.quality
        });
      } else {
        this._updateStatus('Завершено');
        this.elements.liveIndicator.style.display = 'none';
      }
    }

    _renderSchedule() {
      if (!this.broadcastProgram || !this.elements.schedule) return;

      this.elements.schedule.innerHTML = '';
      const startTime = new Date(this.broadcastProgram.broadcastStartTime).getTime() / 1000;

      this.broadcastProgram.programSchedule.forEach((video, index) => {
        const li = document.createElement('li');
        li.className = 'ytss-schedule-item';
        li.dataset.index = index;

        const start = new Date((startTime + video.startTime) * 1000);
        const end = new Date((startTime + video.startTime + video.duration) * 1000);

        li.innerHTML = `
          <div><strong>${video.title || 'Відео #' + (index + 1)}</strong></div>
          <div><small>
            ${start.getHours().toString().padStart(2, '0')}:${start.getMinutes().toString().padStart(2, '0')} —
            ${end.getHours().toString().padStart(2, '0')}:${end.getMinutes().toString().padStart(2, '0')}
          </small></div>
        `;

        this.elements.schedule.appendChild(li);
      });
    }

    _highlightCurrent() {
      const