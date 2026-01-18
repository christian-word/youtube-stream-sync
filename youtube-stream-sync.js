/**
 * YouTube Stream Sync Library
 * Версія: 1.0.1
 * Ліцензія: MIT
 * 
 * Бібліотека для створення 24/7 YouTube трансляцій з автоматичною синхронізацією
 */

(function(window) {
  'use strict';

  const VERSION = '1.0.1';

  class YouTubeStreamSync {
    
    constructor(options = {}) {
      this.options = {
        container: '#youtube-stream-sync',
        playlistUrl: null,
        theme: 'light',
        autoplay: false,
        showSchedule: true,
        showControls: true,
        locale: 'uk-UA',
        timezone: 0,
        quality: 'default',
        width: '100%',
        maxWidth: null,
        aspectRatio: '16:9',
        strictLiveMode: false,  // ← НОВИЙ ПАРАМЕТР!
        customStyles: null,
        onReady: null,
        onPlay: null,
        onVideoChange: null,
        onError: null,
        ...options
      };

      if (!this.options.playlistUrl) {
        throw new Error('YouTubeStreamSync: playlistUrl є обов\'язковим параметром');
      }

      this.player = null;
      this.currentVideoIndex = 0;
      this.broadcastProgram = null;
      this.timers = { sync: null, progress: null, remaining: null };
      this.watchedVideos = this._loadWatchedVideos();
      
      this.init();
    }

    async init() {
      try {
        this.container = document.querySelector(this.options.container);
        if (!this.container) {
          throw new Error(`Контейнер "${this.options.container}" не знайдено`);
        }

        await this._loadYouTubeAPI();
        this._createUI();
        this._applyStyles();
        await this._loadPlaylist();
        this._initPlayer();

        if (typeof this.options.onReady === 'function') {
          this.options.onReady(this);
        }
      } catch (error) {
        this._handleError(error);
      }
    }

    _loadYouTubeAPI() {
      return new Promise((resolve, reject) => {
        if (window.YT && window.YT.Player) {
          resolve();
          return;
        }

        if (document.querySelector('script[src*="youtube.com/iframe_api"]')) {
          window.onYouTubeIframeAPIReady = resolve;
          return;
        }

        const script = document.createElement('script');
        script.src = 'https://www.youtube.com/iframe_api';
        script.async = true;
        script.onerror = () => reject(new Error('Не вдалося завантажити YouTube API'));
        
        window.onYouTubeIframeAPIReady = resolve;
        document.head.appendChild(script);
      });
    }

    _createUI() {
      const uniqueId = 'ytss-' + Math.random().toString(36).substr(2, 9);
      const aspectRatioPadding = this._calculateAspectRatio();
      
      this.container.innerHTML = `
        <div class="ytss-wrapper" data-theme="${this.options.theme}" style="width: ${this.options.width}; ${this.options.maxWidth ? 'max-width: ' + this.options.maxWidth : ''}">
          <div class="ytss-player-container">
            <div class="ytss-player-wrapper" style="padding-bottom: ${aspectRatioPadding}%">
              <div id="${uniqueId}-player" class="ytss-player"></div>
              
              <div class="ytss-live-indicator" style="display: none;">
                <span class="ytss-pulse-dot"></span>
                <span>LIVE</span>
              </div>
              
              <div class="ytss-loading" style="display: none;">
                <div class="ytss-spinner"></div>
                <span>Завантаження...</span>
              </div>
              
              <div class="ytss-start-overlay">
                <div class="ytss-start-content">
                  <div class="ytss-start-icon">▶</div>
                  <h3>Готові дивитися?</h3>
                  <p>Натисніть кнопку нижче</p>
                  <button class="ytss-btn ytss-btn-primary ytss-start-btn">Відтворити</button>
                </div>
              </div>
              
              ${this.options.strictLiveMode ? this._createStrictModeElements() : ''}
            </div>
            
            <div class="ytss-progress-container">
              <div class="ytss-progress-bar"></div>
            </div>
            
            ${this.options.showControls ? this._createControls() : ''}
          </div>
          
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
          
          ${this.options.showSchedule ? `
            <div class="ytss-schedule">
              <div class="ytss-schedule-header">
                <h3>Розклад</h3>
                <button class="ytss-btn ytss-btn-small ytss-scroll-btn" style="display: none;">До поточного</button>
              </div>
              <ul class="ytss-schedule-list" id="${uniqueId}-schedule"></ul>
            </div>
          ` : ''}
          
          <div class="ytss-toast"></div>
        </div>
      `;

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
        scrollBtn: this.container.querySelector('.ytss-scroll-btn'),
        playerBlocker: this.container.querySelector('.ytss-player-blocker'),
        volumeControl: this.container.querySelector('.ytss-volume-control'),
        volumeSlider: this.container.querySelector('.ytss-volume-slider'),
        volumeIcon: this.container.querySelector('.ytss-volume-icon')
      };

      this._bindEvents();
      
      if (this.options.strictLiveMode) {
        this._initStrictMode();
      }
    }

    _createStrictModeElements() {
      return `
        <!-- Блокуючий оверлей -->
        <div class="ytss-player-blocker">
          <div class="ytss-blocker-message">
            <div class="ytss-blocker-icon">🔴</div>
            <p>Це пряма трансляція</p>
            <small>Керування через кнопки нижче</small>
          </div>
        </div>
        
        <!-- Кастомна панель гучності -->
        <div class="ytss-volume-control" style="display: none;">
          <div class="ytss-volume-icon">🔊</div>
          <input type="range" class="ytss-volume-slider" min="0" max="100" value="100">
        </div>
      `;
    }

    _createControls() {
      return `
        <div class="ytss-controls">
          <button class="ytss-btn ytss-play-btn">▶ Відтворити</button>
          <select class="ytss-select ytss-quality-select">
            <option value="default">Авто</option>
            <option value="small">360p</option>
            <option value="medium">480p</option>
            <option value="large">720p</option>
            <option value="hd1080">1080p</option>
          </select>
          <select class="ytss-select ytss-timezone-select">
            <option value="0">Час: 0</option>
            <option value="3600">+1 год</option>
            <option value="-3600">-1 год</option>
          </select>
        </div>
      `;
    }

    _bindEvents() {
      if (this.elements.startBtn) {
        this.elements.startBtn.addEventListener('click', () => this.play());
      }
      if (this.elements.playBtn) {
        this.elements.playBtn.addEventListener('click', () => this.play());
      }
      if (this.elements.qualitySelect) {
        this.elements.qualitySelect.addEventListener('change', () => {
          this.setQuality(this.elements.qualitySelect.value);
        });
      }
      if (this.elements.timezoneSelect) {
        this.elements.timezoneSelect.addEventListener('change', () => {
          this.options.timezone = parseInt(this.elements.timezoneSelect.value);
          this.play();
        });
      }
      if (this.elements.scrollBtn) {
        this.elements.scrollBtn.addEventListener('click', () => this._scrollToCurrent());
      }
    }

    _initStrictMode() {
      // Гучність
      if (this.elements.volumeSlider && this.elements.volumeIcon) {
        this.elements.volumeSlider.addEventListener('input', (e) => {
          const volume = e.target.value;
          if (this.player && this.player.setVolume) {
            this.player.setVolume(volume);
            
            if (volume == 0) {
              this.elements.volumeIcon.textContent = '🔇';
            } else if (volume < 50) {
              this.elements.volumeIcon.textContent = '🔉';
            } else {
              this.elements.volumeIcon.textContent = '🔊';
            }
          }
        });

        this.elements.volumeIcon.addEventListener('click', () => {
          const currentVolume = this.elements.volumeSlider.value;
          if (currentVolume > 0) {
            this.elements.volumeSlider.value = 0;
            this.elements.volumeIcon.textContent = '🔇';
            this.player.setVolume(0);
          } else {
            this.elements.volumeSlider.value = 100;
            this.elements.volumeIcon.textContent = '🔊';
            this.player.setVolume(100);
          }
        });
      }

      // Блокування клавіатури
      document.addEventListener('keydown', (e) => {
        if (['Space', 'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.code)) {
          if (e.target.tagName !== 'INPUT' && e.target.tagName !== 'SELECT') {
            e.preventDefault();
          }
        }
      });

      // Блокування контекстного меню
      const playerElement = document.getElementById(this.elements.playerId);
      if (playerElement) {
        playerElement.addEventListener('contextmenu', (e) => {
          e.preventDefault();
        });
      }
    }

    _applyStyles() {
      if (document.getElementById('ytss-styles')) return;

      const style = document.createElement('style');
      style.id = 'ytss-styles';
      style.textContent = this._getDefaultStyles();
      document.head.appendChild(style);

      if (this.options.customStyles) {
        const customStyle = document.createElement('style');
        customStyle.textContent = this.options.customStyles;
        document.head.appendChild(customStyle);
      }
    }

    _getDefaultStyles() {
      return `
        .ytss-wrapper{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;max-width:100%;margin:0 auto}
        .ytss-wrapper *{box-sizing:border-box}
        .ytss-wrapper[data-theme="light"]{--ytss-bg:#fff;--ytss-text:#2B2D42;--ytss-border:#e5e7eb;--ytss-primary:#D4AF37}
        .ytss-wrapper[data-theme="dark"]{--ytss-bg:#18181B;--ytss-text:#EFEFEF;--ytss-border:#27272A;--ytss-primary:#9146FF}
        .ytss-player-container{background:var(--ytss-bg);border-radius:12px;overflow:hidden;box-shadow:0 4px 12px rgba(0,0,0,.1)}
        .ytss-player-wrapper{position:relative;width:100%;height:0}
        .ytss-player{position:absolute;top:0;left:0;width:100%;height:100%}
        .ytss-player iframe{pointer-events:auto}
        .ytss-player.strict-mode iframe{pointer-events:none!important}
        .ytss-player.strict-mode .ytp-chrome-bottom,.ytss-player.strict-mode .ytp-chrome-top,.ytss-player.strict-mode .ytp-gradient-bottom,.ytss-player.strict-mode .ytp-gradient-top,.ytss-player.strict-mode .ytp-pause-overlay,.ytss-player.strict-mode .ytp-cards-teaser,.ytss-player.strict-mode .ytp-watermark{display:none!important;opacity:0!important;visibility:hidden!important}
        .ytss-player-blocker{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.01);z-index:10;display:flex;align-items:center;justify-content:center;cursor:default;transition:background .3s;pointer-events:auto}
        .ytss-player-blocker.hidden{pointer-events:none;opacity:0}
        .ytss-player-blocker:not(.hidden):hover{background:rgba(0,0,0,.7)}
        .ytss-blocker-message{opacity:0;transition:opacity .3s;text-align:center;color:#fff;pointer-events:none}
        .ytss-player-blocker:hover .ytss-blocker-message{opacity:1}
        .ytss-blocker-icon{font-size:3rem;margin-bottom:10px;animation:ytss-pulse-icon 2s infinite}
        @keyframes ytss-pulse-icon{0%,100%{transform:scale(1)}50%{transform:scale(1.1)}}
        .ytss-blocker-message p{font-size:1.3rem;font-weight:700;margin-bottom:5px}
        .ytss-blocker-message small{font-size:.9rem;opacity:.8}
        .ytss-volume-control{position:absolute;bottom:20px;right:20px;display:flex;align-items:center;gap:10px;background:rgba(0,0,0,.8);padding:10px 15px;border-radius:50px;z-index:20;opacity:0;transition:opacity .3s;pointer-events:auto!important}
        .ytss-player-wrapper:hover .ytss-volume-control{opacity:1}
        .ytss-volume-icon{font-size:1.5rem;cursor:pointer;user-select:none}
        .ytss-volume-slider{width:100px;height:6px;border-radius:3px;background:#444;outline:none;-webkit-appearance:none;cursor:pointer}
        .ytss-volume-slider::-webkit-slider-thumb{-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:#D4AF37;cursor:pointer}
        .ytss-volume-slider::-moz-range-thumb{width:16px;height:16px;border-radius:50%;background:#D4AF37;cursor:pointer;border:none}
        .ytss-live-indicator{position:absolute;top:12px;left:12px;background:rgba(239,68,68,.9);color:#fff;padding:6px 12px;border-radius:20px;font-size:11px;font-weight:700;z-index:10;display:flex;align-items:center;gap:6px}
        .ytss-pulse-dot{width:8px;height:8px;background:#fff;border-radius:50%;animation:ytss-pulse 1.5s infinite}
        @keyframes ytss-pulse{0%,100%{opacity:1}50%{opacity:.3}}
        .ytss-loading{position:absolute;top:0;left:0;width:100%;height:100%;background:rgba(0,0,0,.8);display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;z-index:100;color:#fff}
        .ytss-spinner{width:50px;height:50px;border:4px solid rgba(255,255,255,.3);border-top:4px solid var(--ytss-primary);border-radius:50%;animation:ytss-spin 1s linear infinite}
        @keyframes ytss-spin{0%{transform:rotate(0)}100%{transform:rotate(360deg)}}
        .ytss-start-overlay{position:absolute;top:0;left:0;width:100%;height:100%;background:linear-gradient(135deg,rgba(45,106,79,.95),rgba(69,123,157,.95));display:flex;align-items:center;justify-content:center;z-index:50;transition:opacity .5s}
        .ytss-start-overlay.hidden{opacity:0;pointer-events:none}
        .ytss-start-content{text-align:center;color:#fff;padding:40px}
        .ytss-start-icon{font-size:4rem;margin-bottom:20px;opacity:.9}
        .ytss-start-content h3{font-size:1.8rem;margin-bottom:12px}
        .ytss-start-content p{font-size:1rem;opacity:.9;margin-bottom:24px}
        .ytss-progress-container{height:4px;background:rgba(0,0,0,.1);cursor:pointer}
        .ytss-progress-bar{height:100%;background:var(--ytss-primary);width:0;transition:width .1s linear}
        .ytss-controls{display:flex;gap:12px;padding:16px;flex-wrap:wrap}
        .ytss-btn{padding:10px 20px;border-radius:8px;border:none;font-weight:600;cursor:pointer;transition:all .3s;font-size:14px}
        .ytss-btn-primary{background:var(--ytss-primary);color:#fff}
        .ytss-btn-primary:hover{opacity:.9;transform:translateY(-1px)}
        .ytss-btn-small{padding:6px 12px;font-size:12px}
        .ytss-select{padding:10px 14px;border-radius:8px;border:1px solid var(--ytss-border);background:var(--ytss-bg);color:var(--ytss-text);cursor:pointer;font-size:14px;flex:1;min-width:120px}
        .ytss-status-bar{display:flex;gap:20px;padding:12px 16px;background:var(--ytss-bg);border-top:1px solid var(--ytss-border);font-size:13px;flex-wrap:wrap}
        .ytss-status-label{color:var(--ytss-text);opacity:.7;margin-right:6px}
        .ytss-status-value{color:var(--ytss-text);font-weight:600}
        .ytss-schedule{margin-top:20px}
        .ytss-schedule-header{display:flex;justify-content:space-between;align-items:center;margin-bottom:12px;flex-wrap:wrap;gap:10px}
        .ytss-schedule-header h3{margin:0;color:var(--ytss-text);font-size:1.2rem}
        .ytss-schedule-list{list-style:none;padding:0;margin:0;max-height:400px;overflow-y:auto}
        .ytss-schedule-item{background:var(--ytss-bg);padding:12px 16px;margin-bottom:8px;border-radius:8px;border:2px solid transparent;transition:all .3s}
        .ytss-schedule-item.current{border-color:var(--ytss-primary);background:rgba(212,175,55,.1)}
        .ytss-schedule-item.played{opacity:.5}
        .ytss-toast{position:fixed;bottom:20px;left:50%;transform:translateX(-50%);background:var(--ytss-bg);color:var(--ytss-text);padding:12px 24px;border-radius:8px;box-shadow:0 4px 12px rgba(0,0,0,.2);opacity:0;pointer-events:none;transition:opacity .3s;z-index:10000}
        .ytss-toast.show{opacity:1}
        @media (max-width:768px){.ytss-controls{flex-direction:column}.ytss-select{width:100%}}
      `;
    }

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

    _initPlayer() {
      const playerVars = {
        playsinline: 1,
        rel: 0,
        modestbranding: 1
      };

      // Додаткові параметри для strictLiveMode
      if (this.options.strictLiveMode) {
        playerVars.controls = 0;
        playerVars.disablekb = 1;
        playerVars.fs = 0;
        playerVars.iv_load_policy = 3;
      }

      this.player = new YT.Player(this.elements.playerId, {
        height: '100%',
        width: '100%',
        playerVars: playerVars,
        events: {
          onReady: () => this._onPlayerReady(),
          onStateChange: (e) => this._onPlayerStateChange(e)
        }
      });
    }

    _onPlayerReady() {
      if (this.options.autoplay) {
        this.play();
      }
    }

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

    // ========== ПУБЛІЧНІ МЕТОДИ API ==========

    play() {
      if (!this.broadcastProgram) {
        this._showToast('Плейлист ще не завантажено');
        return;
      }

      if (this.elements.startOverlay) {
        this.elements.startOverlay.classList.add('hidden');
      }

      // Strict mode: показуємо/ховаємо блокувальник і гучність
      if (this.options.strictLiveMode) {
        if (this.elements.playerBlocker) {
          this.elements.playerBlocker.classList.add('hidden');
        }
        if (this.elements.volumeControl) {
          this.elements.volumeControl.style.display = 'flex';
        }
      }

      this._clearTimers();
      this._startBroadcast();
    }

    stop() {
      if (this.player && this.player.stopVideo) {
        this.player.stopVideo();
      }
      this._clearTimers();

      // Strict mode: повертаємо блокувальник
      if (this.options.strictLiveMode) {
        if (this.elements.playerBlocker) {
          this.elements.playerBlocker.classList.remove('hidden');
        }
        if (this.elements.volumeControl) {
          this.elements.volumeControl.style.display = 'none';
        }
      }
    }

    setQuality(quality) {
      this.options.quality = quality;
      
      // YouTube setPlaybackQuality не працює надійно
      // Потрібно перезавантажити відео з новою якістю
      if (this.player && this.player.getVideoData && this.currentVideoIndex >= 0) {
        const currentTime = this.player.getCurrentTime();
        const currentVideo = this.broadcastProgram.programSchedule[this.currentVideoIndex];
        
        if (currentVideo) {
          this.player.loadVideoById({
            videoId: currentVideo.videoId,
            startSeconds: currentTime,
            suggestedQuality: quality
          });
        }
      }
      
      this._showToast(`Якість змінено: ${this._getQualityName(quality)}`);
    }

    _getQualityName(quality) {
      const names = {
        'small': '360p',
        'medium': '480p',
        'large': '720p',
        'hd1080': '1080p',
        'default': 'Авто'
      };
      return names[quality] || quality;
    }

    getCurrentVideo() {
      if (!this.broadcastProgram) return null;
      return this.broadcastProgram.programSchedule[this.currentVideoIndex];
    }

    getPlaylist() {
      return this.broadcastProgram;
    }

    getSchedule() {
      if (!this.broadcastProgram) return [];
      return this.broadcastProgram.programSchedule;
    }

    getCurrentIndex() {
      return this.currentVideoIndex;
    }

    goToVideo(index) {
      if (!this.broadcastProgram || index < 0 || index >= this.broadcastProgram.programSchedule.length) {
        console.warn('Невірний індекс відео');
        return;
      }

      this.currentVideoIndex = index;
      const video = this.broadcastProgram.programSchedule[index];
      
      if (this.player && video) {
        this.player.loadVideoById({
          videoId: video.videoId,
          startSeconds: 0,
          suggestedQuality: this.options.quality
        });
        this._highlightCurrent();
        
        if (typeof this.options.onVideoChange === 'function') {
          this.options.onVideoChange(index, video);
        }
      }
    }

    getBroadcastStartTime() {
      if (!this.broadcastProgram) return null;
      return new Date(this.broadcastProgram.broadcastStartTime);
    }

    on(eventName, callback) {
      const events = ['ready', 'play', 'videoChange', 'error'];
      if (!events.includes(eventName)) {
        console.warn(`Невідома подія: ${eventName}`);
        return;
      }

      const optionName = 'on' + eventName.charAt(0).toUpperCase() + eventName.slice(1);
      const existingCallback = this.options[optionName];
      
      this.options[optionName] = (...args) => {
        if (existingCallback) existingCallback(...args);
        callback(...args);
      };
    }

    destroy() {
      this._clearTimers();
      if (this.player && this.player.destroy) {
        this.player.destroy();
      }
      this.container.innerHTML = '';
    }

    // ========== ВНУТРІШНІ МЕТОДИ ==========

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
          return { video: video, seconds: elapsed - video.startTime, index: i };
        }
      }

      return { video: null, seconds: 0, index: 0 };
    }

    _startSyncTimer(startTime) {
      this.timers.sync = setInterval(() => {
        const now = Date.now() / 1000;
        const elapsed = now - startTime + this.options.timezone;
        
        const time = new Date((startTime + elapsed) * 1000);
        this._updateTime(time.toLocaleTimeString(this.options.locale));

        const videoData = this._findCurrentVideo(elapsed);
        
        if (videoData.index !== -1 && videoData.index !== this.currentVideoIndex) {
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

        if (videoData.seconds !== undefined) {
          const drift = this.player.getCurrentTime() - videoData.seconds;
          if (Math.abs(drift) > 1) {
            this.player.setPlaybackRate(drift > 0 ? 0.9 : 1.1);
          } else {
            this.player.setPlaybackRate(1);
          }
        }
      }, 1000);

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
      const items = this.container.querySelectorAll('.ytss-schedule-item');
      items.forEach((item, i) => {
        item.classList.remove('current', 'played');
        if (i < this.currentVideoIndex) {
          item.classList.add('played');
        } else if (i === this.currentVideoIndex) {
          item.classList.add('current');
        }
      });
    }

    _scrollToCurrent() {
      const current = this.container.querySelector('.ytss-schedule-item.current');
      if (current && this.elements.schedule) {
        current.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }

    _clearTimers() {
      Object.values(this.timers).forEach(timer => {
        if (timer) clearInterval(timer);
      });
    }

    _updateStatus(text) {
      if (this.elements.status) {
        this.elements.status.textContent = text;
      }
    }

    _updateTime(text) {
      if (this.elements.time) {
        this.elements.time.textContent = text;
      }
    }

    _showToast(message) {
      if (!this.elements.toast) return;
      
      this.elements.toast.textContent = message;
      this.elements.toast.classList.add('show');
      
      setTimeout(() => {
        this.elements.toast.classList.remove('show');
      }, 3000);
    }

    _loadWatchedVideos() {
      try {
        return JSON.parse(localStorage.getItem('ytss-watched') || '[]');
      } catch {
        return [];
      }
    }

    _markAsWatched(videoId) {
      if (!this.watchedVideos.includes(videoId)) {
        this.watchedVideos.push(videoId);
        localStorage.setItem('ytss-watched', JSON.stringify(this.watchedVideos));
      }
    }

    _calculateAspectRatio() {
      const ratio = this.options.aspectRatio;
      
      if (ratio === '16:9') return 56.25;
      if (ratio === '4:3') return 75;
      if (ratio === '21:9') return 42.86;
      if (ratio === '1:1') return 100;
      
      if (typeof ratio === 'string' && ratio.includes(':')) {
        const [w, h] = ratio.split(':').map(Number);
        return (h / w) * 100;
      }
      
      if (typeof ratio === 'number') {
        return ratio * 100;
      }
      
      return 56.25;
    }

    _handleError(error) {
      console.error('YouTubeStreamSync Error:', error);
      this._updateStatus('Помилка: ' + error.message);
      
      if (typeof this.options.onError === 'function') {
        this.options.onError(error);
      }
    }

    static get version() {
      return VERSION;
    }
  }

  window.YouTubeStreamSync = YouTubeStreamSync;

  if (typeof define === 'function' && define.amd) {
    define([], function() { return YouTubeStreamSync; });
  } else if (typeof module === 'object' && module.exports) {
    module.exports = YouTubeStreamSync;
  }

})(window);
