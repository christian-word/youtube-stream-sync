/**
 * YouTube Stream Sync Library v2.1.1
 * Исправленная версия: корректное встраивание и размеры
 */
(function(window) {
'use strict';

class YouTubeStreamSync {
    constructor(options = {}) {
        this.config = {
            containerId: options.containerId || 'player',
            playlistUrl: options.playlistUrl || null,
            autoPlay: options.autoPlay !== false,
            debug: options.debug || false,
            enableOverlay: options.enableOverlay !== false,
            onReady: options.onReady || null,
            onVideoChange: options.onVideoChange || null,
            onError: options.onError || null
        };

        this.player = null;
        this.isReady = false;
        this.isSyncing = false;
        this.currentVideoIndex = -1;
        this.broadcastProgram = null;
        this.syncTimer = null;

        this.init();
    }

    init() {
        if (!window.YT) {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            document.head.appendChild(tag);
        }

        const previousHandler = window.onYouTubeIframeAPIReady;
        window.onYouTubeIframeAPIReady = () => {
            if (previousHandler) previousHandler();
            this.createPlayer();
        };
        
        // Если API уже загружено
        if (window.YT && window.YT.Player) {
            this.createPlayer();
        }
    }

    createPlayer() {
        this.log('Инициализация плеера в контейнере:', this.config.containerId);
        
        const playerVars = {
            autoplay: 0,
            controls: 0,
            disablekb: 1,
            fs: 0,
            modestbranding: 1,
            rel: 0,
            showinfo: 0,
            iv_load_policy: 3,
            playsinline: 1,
            enablejsapi: 1,
            origin: window.location.origin
        };

        this.player = new YT.Player(this.config.containerId, {
            width: '100%',
            height: '100%',
            playerVars: playerVars,
            events: {
                onReady: (e) => this.onPlayerReady(e),
                onStateChange: (e) => this.onPlayerStateChange(e),
                onError: (e) => this.onPlayerError(e)
            }
        });

        if (this.config.enableOverlay) {
            this.createOverlay();
        }
    }

    createOverlay() {
        const wrapper = document.getElementById(this.config.containerId).parentElement;
        if (!wrapper) return;

        const overlay = document.createElement('div');
        overlay.style.cssText = `
            position: absolute; top: 0; left: 0; width: 100%; height: 100%;
            z-index: 10; background: transparent; cursor: default;
        `;
        
        // Блокировка кликов, чтобы пользователь не мог вызвать меню YouTube
        overlay.addEventListener('contextmenu', e => e.preventDefault());
        wrapper.style.position = 'relative';
        wrapper.appendChild(overlay);
    }

    onPlayerReady(event) {
        this.isReady = true;
        this.log('YouTube API готово');
        this.loadPlaylist();
        if (this.config.onReady) this.config.onReady(this);
    }

    async loadPlaylist() {
        try {
            const response = await fetch(this.config.playlistUrl);
            const data = await response.json();
            
            let totalTime = 0;
            data.programSchedule.forEach(v => {
                v.startTime = totalTime;
                totalTime += v.duration;
            });
            
            this.broadcastProgram = data;
            this.startSync();
        } catch (e) {
            this.error('Ошибка загрузки плейлиста', e);
        }
    }

    startSync() {
        if (this.syncTimer) clearInterval(this.syncTimer);
        this.syncCurrentVideo();
        this.syncTimer = setInterval(() => this.syncCurrentVideo(), 2000);
        this.isSyncing = true;
    }

    syncCurrentVideo() {
        if (!this.player || !this.broadcastProgram) return;

        const now = Date.now() / 1000;
        const start = new Date(this.broadcastProgram.broadcastStartTime).getTime() / 1000;
        const elapsed = now - start;

        let videoToPlay = null;
        let index = 0;

        for (let i = 0; i < this.broadcastProgram.programSchedule.length; i++) {
            const v = this.broadcastProgram.programSchedule[i];
            if (elapsed >= v.startTime && elapsed < v.startTime + v.duration) {
                videoToPlay = v;
                index = i;
                break;
            }
        }

        if (videoToPlay) {
            const targetTime = elapsed - videoToPlay.startTime;
            
            if (this.currentVideoIndex !== index) {
                this.currentVideoIndex = index;
                this.player.loadVideoById({
                    videoId: videoToPlay.videoId,
                    startSeconds: targetTime
                });
                if (this.config.onVideoChange) this.config.onVideoChange({ video: videoToPlay });
            } else {
                const drift = Math.abs(this.player.getCurrentTime() - targetTime);
                if (drift > 2) this.player.seekTo(targetTime, true);
            }
        }
    }

    onPlayerStateChange(event) {
        // Если видео встало на паузу - принудительно запускаем (эффект стрима)
        if (event.data === YT.PlayerState.PAUSED && this.isSyncing) {
            this.player.playVideo();
        }
    }

    log(...msg) { if (this.config.debug) console.log('[Sync]', ...msg); }
    error(...msg) { console.error('[Sync Error]', ...msg); }
}

window.YouTubeStreamSync = YouTubeStreamSync;
})(window);