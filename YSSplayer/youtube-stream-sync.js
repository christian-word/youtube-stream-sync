/**
 * YouTube Stream Sync Library
 * Библиотека для создания виртуального 24/7 стрима из плейлиста
 * @version 2.0.0
 */
(function(window) {
'use strict';

class YouTubeStreamSync {
    constructor(options = {}) {
        // === Конфигурация ===
        this.config = {
            containerId: options.containerId || 'player-container',
            playlistUrl: options.playlistUrl || '',
            broadcastStartTime: options.broadcastStartTime || new Date().toISOString(),
            timezoneOffset: options.timezoneOffset || 0,
            autoQuality: options.autoQuality || 'default',
            enableOverlay: options.enableOverlay !== false,
            autoPlay: options.autoPlay !== false,
            debug: options.debug || false,
            
            // Callbacks
            onReady: options.onReady || null,
            onVideoChange: options.onVideoChange || null,
            onError: options.onError || null,
            onSync: options.onSync || null
        };

        // === Состояние ===
        this.player = null;
        this.isReady = false;
        this.isSyncing = false;
        this.currentVideoIndex = 0;
        this.broadcastProgram = null;
        this.syncTimer = null;
        this.progressTimer = null;
        this.overlayElement = null;
        this.watchedVideos = JSON.parse(localStorage.getItem('watchedVideos') || '[]');

        // === Инициализация ===
        this.init();
    }

    // === Инициализация ===
    init() {
        if (!window.YT) {
            this.loadYouTubeAPI();
        } else if (window.YT.Player) {
            this.createPlayer();
        }

        window.onYouTubeIframeAPIReady = () => {
            this.createPlayer();
        };
    }

    loadYouTubeAPI() {
        const tag = document.createElement('script');
        tag.src = 'https://www.youtube.com/iframe_api';
        const firstScriptTag = document.getElementsByTagName('script')[0];
        firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
    }

    // === Создание плеера ===
    createPlayer() {
        const container = document.getElementById(this.config.containerId);
        if (!container) {
            this.error(`Container "${this.config.containerId}" не найден`);
            return;
        }

        // Создаём элемент для плеера
        const playerDiv = document.createElement('div');
        playerDiv.id = 'youtube-player-iframe';
        container.appendChild(playerDiv);

        // Параметры плеера - ВСЁ ВЫКЛЮЧЕНО для стрима
        const playerVars = {
            autoplay: 0,
            controls: 0,                    // ❌ Нет контролов
            disablekb: 1,                   // ❌ Нет клавиатуры
            fs: 0,                          // ❌ Нет полноэкранного режима
            modestbranding: 1,              // ✅ Минимальный брендинг
            rel: 0,                         // ❌ Нет рекомендаций
            showinfo: 0,                    // ❌ Нет информации
            iv_load_policy: 3,              // ❌ Нет аннотаций
            playsinline: 1,                 // ✅ Встроенный режим
            enablejsapi: 1,                 // ✅ API включено
            origin: window.location.origin,
            cc_load_policy: 0,              // ❌ Нет субтитров
            loop: 0                         // ❌ Не зацикливать
        };

        // Создание плеера
        this.player = new YT.Player(playerDiv.id, {
            width: '100%',
            height: '100%',
            videoId: '',
            playerVars: playerVars,
            events: {
                onReady: (e) => this.onPlayerReady(e),
                onStateChange: (e) => this.onPlayerStateChange(e),
                onError: (e) => this.onPlayerError(e)
            }
        });

        // Создание оверлея для блокировки кликов
        if (this.config.enableOverlay) {
            this.createOverlay(container);
        }
    }

    // === Оверлей для блокировки всех взаимодействий ===
    createOverlay(container) {
        this.overlayElement = document.createElement('div');
        this.overlayElement.style.cssText = `
            position: absolute;
            top: 0;
            left: 0;
            width: 100%;
            height: 100%;
            z-index: 10;
            cursor: default;
            background: transparent;
            pointer-events: none;
            transition: opacity 0.3s ease;
        `;

        // Полная блокировка всех событий
        const preventEvents = [
            'click', 'dblclick', 'mousedown', 'mouseup', 'mousemove',
            'touchstart', 'touchend', 'touchmove', 'touchcancel',
            'contextmenu', 'wheel'
        ];

        preventEvents.forEach(eventType => {
            this.overlayElement.addEventListener(eventType, (e) => {
                e.preventDefault();
                e.stopPropagation();
                return false;
            }, { passive: false, capture: true });
        });

        container.style.position = 'relative';
        container.appendChild(this.overlayElement);
    }

    // === Callbacks плеера ===
    onPlayerReady(event) {
        this.isReady = true;
        this.log('YouTube плеер готов');
        
        // Загружаем плейлист
        this.loadPlaylist();
        
        if (this.config.onReady) {
            this.config.onReady(this);
        }
    }

    onPlayerStateChange(event) {
        const state = event.data;
        
        // YT.PlayerState.PLAYING = 1
        if (state === 1 && !this.isSyncing) {
            this.startSync();
        }
        
        // YT.PlayerState.ENDED = 0
        if (state === 0) {
            this.handleVideoEnd();
        }
        
        // YT.PlayerState.PAUSED = 2 - автовозобновление для стрима
        if (state === 2) {
            setTimeout(() => {
                if (this.player && this.player.getPlayerState() === 2) {
                    this.player.playVideo();
                }
            }, 1000);
        }
    }

    onPlayerError(event) {
        this.error('Ошибка плеера:', event.data);
        if (this.config.onError) {
            this.config.onError(event, this);
        }
    }

    // === Загрузка плейлиста ===
    async loadPlaylist() {
        if (!this.config.playlistUrl) {
            this.error('URL плейлиста не указан');
            return;
        }

        try {
            const response = await fetch(this.config.playlistUrl);
            if (!response.ok) throw new Error('Не удалось загрузить плейлист');
            
            const data = await response.json();
            
            // Рассчитываем время начала для каждого видео
            let totalTime = 0;
            data.programSchedule.forEach(video => {
                video.startTime = totalTime;
                totalTime += video.duration;
            });
            
            this.broadcastProgram = data;
            this.log('Плейлист загружен:', data.programSchedule.length, 'видео');
            
            // Запускаем стрим
            if (this.config.autoPlay) {
                this.startStream();
            }
            
        } catch (err) {
            this.error('Ошибка загрузки плейлиста:', err);
            if (this.config.onError) {
                this.config.onError(err, this);
            }
        }
    }

    // === Запуск стрима ===
    startStream() {
        if (!this.broadcastProgram || !this.isReady) return;
        
        this.log('Запуск стрима...');
        
        // Скрываем оверлей если он был
        if (this.overlayElement) {
            this.overlayElement.style.opacity = '0';
            setTimeout(() => {
                this.overlayElement.style.pointerEvents = 'none';
            }, 300);
        }
        
        // Останавливаем предыдущие таймеры
        this.stopSync();
        
        // Запускаем синхронизацию
        this.startSync();
    }

    // === Синхронизация ===
    startSync() {
        if (this.isSyncing) return;
        
        this.isSyncing = true;
        this.syncCurrentVideo();
        
        // Периодическая синхронизация
        this.syncTimer = setInterval(() => {
            this.syncCurrentVideo();
        }, 1000);
        
        this.log('Синхронизация запущена');
    }

    stopSync() {
        if (this.syncTimer) {
            clearInterval(this.syncTimer);
            this.syncTimer = null;
        }
        if (this.progressTimer) {
            clearInterval(this.progressTimer);
            this.progressTimer = null;
        }
        this.isSyncing = false;
    }

    // === Синхронизация текущего видео ===
    syncCurrentVideo() {
        if (!this.player || !this.isReady || !this.broadcastProgram) return;
        
        const now = Date.now() / 1000;
        const broadcastStart = new Date(this.broadcastProgram.broadcastStartTime).getTime() / 1000;
        const offset = this.config.timezoneOffset;
        const elapsedTime = now - broadcastStart + offset;
        
        // Находим текущее видео
        let currentVideo = null;
        let currentSecond = 0;
        let currentIndex = 0;
        
        if (elapsedTime < 0) {
            currentVideo = this.broadcastProgram.programSchedule[0];
            currentSecond = 0;
            currentIndex = 0;
        } else {
            for (let i = 0; i < this.broadcastProgram.programSchedule.length; i++) {
                const video = this.broadcastProgram.programSchedule[i];
                if (elapsedTime >= video.startTime && elapsedTime < video.startTime + video.duration) {
                    currentVideo = video;
                    currentSecond = elapsedTime - video.startTime;
                    currentIndex = i;
                    break;
                }
            }
        }
        
        if (!currentVideo) return;
        
        // Если сменилось видео
        if (currentIndex !== this.currentVideoIndex) {
            this.changeVideo(currentVideo, currentSecond, currentIndex);
            return;
        }
        
        // Синхронизируем время внутри видео
        const playerTime = this.player.getCurrentTime();
        const drift = playerTime - currentSecond;
        
        if (Math.abs(drift) > 1) {
            this.player.seekTo(currentSecond, true);
            this.log(`Синхронизация: отклонение ${drift.toFixed(2)}с`);
        }
        
        if (this.config.onSync) {
            this.config.onSync({
                videoIndex: currentIndex,
                videoTime: currentSecond,
                drift: drift
            });
        }
    }

    // === Смена видео ===
    changeVideo(video, startTime, index) {
        if (!this.player || !this.isReady) return;
        
        this.log(`Смена видео: ${video.title} (${index + 1}/${this.broadcastProgram.programSchedule.length})`);
        
        // Отмечаем предыдущее видео как просмотренное
        if (this.currentVideoIndex >= 0) {
            const prevVideo = this.broadcastProgram.programSchedule[this.currentVideoIndex];
            if (prevVideo && !this.watchedVideos.includes(prevVideo.videoId)) {
                this.watchedVideos.push(prevVideo.videoId);
                localStorage.setItem('watchedVideos', JSON.stringify(this.watchedVideos));
            }
        }
        
        // Загружаем новое видео
        this.player.loadVideoById({
            videoId: video.videoId,
            startSeconds: Math.max(0, startTime),
            suggestedQuality: this.config.autoQuality
        });
        
        this.currentVideoIndex = index;
        
        // Callback о смене видео
        if (this.config.onVideoChange) {
            this.config.onVideoChange({
                index: index,
                video: video,
                startTime: startTime
            }, this);
        }
    }

    // === Обработка конца видео ===
    handleVideoEnd() {
        this.currentVideoIndex++;
        
        if (this.currentVideoIndex < this.broadcastProgram.programSchedule.length) {
            const nextVideo = this.broadcastProgram.programSchedule[this.currentVideoIndex];
            this.changeVideo(nextVideo, 0, this.currentVideoIndex);
        } else {
            this.log('Стрим завершён');
            this.stopSync();
        }
    }

    // === Управление качеством ===
    setQuality(quality) {
        if (!this.player || !this.isReady) return;
        
        const qualityMap = {
            'auto': 'default',
            '1080p': 'hd1080',
            '720p': 'hd720',
            '480p': 'large',
            '360p': 'medium',
            '240p': 'small'
        };
        
        const ytQuality = qualityMap[quality] || quality;
        this.player.setPlaybackQuality(ytQuality);
        this.log(`Качество установлено: ${quality}`);
    }

    // === Управление временем ===
    adjustTimezone(hours) {
        this.config.timezoneOffset = hours * 3600;
        this.log(`Часовой пояс изменён: ${hours > 0 ? '+' : ''}${hours}ч`);
        
        if (this.isSyncing) {
            this.syncCurrentVideo();
        }
    }

    // === Получение статуса ===
    getStatus() {
        if (!this.isReady) {
            return { ready: false, status: 'not_ready' };
        }
        
        const states = {
            '-1': 'unstarted',
            '0': 'ended',
            '1': 'playing',
            '2': 'paused',
            '3': 'buffering',
            '5': 'cued'
        };
        
        return {
            ready: this.isReady,
            syncing: this.isSyncing,
            state: states[this.player.getPlayerState()] || 'unknown',
            currentVideoIndex: this.currentVideoIndex,
            currentVideo: this.broadcastProgram?.programSchedule[this.currentVideoIndex],
            currentTime: this.player.getCurrentTime(),
            duration: this.player.getDuration(),
            playlistLoaded: !!this.broadcastProgram,
            watchedCount: this.watchedVideos.length
        };
    }

    // === Утилиты ===
    play() {
        if (this.player) this.player.playVideo();
    }
    
    pause() {
        if (this.player) this.player.pauseVideo();
    }
    
    getCurrentTime() {
        return this.player ? this.player.getCurrentTime() : 0;
    }
    
    destroy() {
        this.stopSync();
        if (this.player) {
            this.player.destroy();
            this.player = null;
        }
        if (this.overlayElement) {
            this.overlayElement.remove();
            this.overlayElement = null;
        }
        this.isReady = false;
        this.log('Плеер уничтожен');
    }
    
    log(...args) {
        if (this.config.debug) {
            console.log('[YouTubeStreamSync]', ...args);
        }
    }
    
    error(...args) {
        console.error('[YouTubeStreamSync]', ...args);
    }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = YouTubeStreamSync;
} else {
    window.YouTubeStreamSync = YouTubeStreamSync;
}

})(typeof window !== 'undefined' ? window : this);