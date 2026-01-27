/**
 * YouTube Sync Player Library
 * Бібліотека для синхронізації YouTube Live трансляцій з блокуванням контролів
 * @version 1.0.0
 */

(function(window) {
    'use strict';

    class YouTubeSyncPlayer {
        constructor(options = {}) {
            // Конфігурація
            this.config = {
                containerId: options.containerId || 'player-container',
                videoId: options.videoId || '',
                startDate: options.startDate || new Date().toISOString(),
                syncInterval: options.syncInterval || 10000, // 10 секунд
                checkInterval: options.checkInterval || 1000, // 1 секунда
                autoQuality: options.autoQuality !== false,
                enableOverlay: options.enableOverlay !== false,
                onReady: options.onReady || null,
                onStateChange: options.onStateChange || null,
                onError: options.onError || null,
                language: options.language || 'uk'
            };

            // Стан плеєра
            this.player = null;
            this.isReady = false;
            this.isSyncing = false;
            this.syncIntervalId = null;
            this.checkIntervalId = null;
            this.startTimestamp = new Date(this.config.startDate).getTime();
            this.overlayElement = null;
            this.lastSyncTime = 0;

            // Ініціалізація
            this.init();
        }

        /**
         * Ініціалізація плеєра
         */
        init() {
            // Завантаження YouTube IFrame API
            if (!window.YT) {
                this.loadYouTubeAPI();
            } else if (window.YT.Player) {
                this.createPlayer();
            }

            // Глобальний callback для YouTube API
            window.onYouTubeIframeAPIReady = () => {
                this.createPlayer();
            };
        }

        /**
         * Завантаження YouTube IFrame API
         */
        loadYouTubeAPI() {
            const tag = document.createElement('script');
            tag.src = 'https://www.youtube.com/iframe_api';
            const firstScriptTag = document.getElementsByTagName('script')[0];
            firstScriptTag.parentNode.insertBefore(tag, firstScriptTag);
        }

        /**
         * Створення YouTube плеєра
         */
        createPlayer() {
            const container = document.getElementById(this.config.containerId);
            if (!container) {
                console.error(`Container with id "${this.config.containerId}" not found`);
                return;
            }

            // Створення елемента для плеєра
            const playerDiv = document.createElement('div');
            playerDiv.id = `${this.config.containerId}-iframe`;
            container.appendChild(playerDiv);

            // Параметри плеєра
            const playerVars = {
                autoplay: 0,
                controls: 0, // Вимкнути контроли
                disablekb: 1, // Вимкнути клавіатуру
                fs: 0, // Вимкнути повний екран
                modestbranding: 1,
                rel: 0,
                showinfo: 0,
                iv_load_policy: 3,
                playsinline: 1,
                enablejsapi: 1,
                origin: window.location.origin
            };

            // Створення плеєра
            this.player = new YT.Player(playerDiv.id, {
                videoId: this.config.videoId,
                playerVars: playerVars,
                events: {
                    onReady: (event) => this.onPlayerReady(event),
                    onStateChange: (event) => this.onPlayerStateChange(event),
                    onError: (event) => this.onPlayerError(event)
                }
            });

            // Створення overlay для блокування контролів
            if (this.config.enableOverlay) {
                this.createOverlay(container);
            }
        }

        /**
         * Створення overlay для блокування взаємодії
         */
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
            `;
            
            // Блокування всіх подій миші та дотику
            const preventEvents = ['click', 'dblclick', 'mousedown', 'mouseup', 
                                  'touchstart', 'touchend', 'touchmove', 'contextmenu'];
            
            preventEvents.forEach(eventType => {
                this.overlayElement.addEventListener(eventType, (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    return false;
                }, true);
            });

            container.style.position = 'relative';
            container.appendChild(this.overlayElement);
        }

        /**
         * Callback при готовності плеєра
         */
        onPlayerReady(event) {
            this.isReady = true;
            
            // Встановлення якості
            if (this.config.autoQuality) {
                this.setQuality('default');
            }

            // Виклик користувацького callback
            if (this.config.onReady) {
                this.config.onReady(event, this);
            }

            console.log('YouTube Sync Player готовий до роботи');
        }

        /**
         * Callback при зміні стану плеєра
         */
        onPlayerStateChange(event) {
            const state = event.data;

            // YT.PlayerState.PLAYING = 1
            if (state === 1 && !this.isSyncing) {
                this.startSync();
            }
            
            // YT.PlayerState.PAUSED = 2
            if (state === 2) {
                // Автоматично відновлюємо відтворення для стріму
                setTimeout(() => {
                    if (this.player && this.player.getPlayerState() === 2) {
                        this.player.playVideo();
                    }
                }, 1000);
            }

            // Виклик користувацького callback
            if (this.config.onStateChange) {
                this.config.onStateChange(event, this);
            }
        }

        /**
         * Callback при помилці плеєра
         */
        onPlayerError(event) {
            console.error('YouTube Player Error:', event.data);
            
            if (this.config.onError) {
                this.config.onError(event, this);
            }
        }

        /**
         * Початок синхронізації
         */
        startSync() {
            if (this.isSyncing) return;
            
            this.isSyncing = true;

            // Перша синхронізація відразу
            this.syncToCurrentTime();

            // Періодична синхронізація
            this.syncIntervalId = setInterval(() => {
                this.syncToCurrentTime();
            }, this.config.syncInterval);

            // Перевірка стану
            this.checkIntervalId = setInterval(() => {
                this.checkPlayerState();
            }, this.config.checkInterval);

            console.log('Синхронізація запущена');
        }

        /**
         * Зупинка синхронізації
         */
        stopSync() {
            if (this.syncIntervalId) {
                clearInterval(this.syncIntervalId);
                this.syncIntervalId = null;
            }

            if (this.checkIntervalId) {
                clearInterval(this.checkIntervalId);
                this.checkIntervalId = null;
            }

            this.isSyncing = false;
            console.log('Синхронізація зупинена');
        }

        /**
         * Синхронізація з поточним часом
         */
        syncToCurrentTime() {
            if (!this.player || !this.isReady) return;

            const currentTime = Date.now();
            const elapsedSeconds = (currentTime - this.startTimestamp) / 1000;
            const currentPlayerTime = this.player.getCurrentTime();
            const timeDifference = Math.abs(elapsedSeconds - currentPlayerTime);

            // Синхронізуємо, якщо різниця більше 3 секунд
            if (timeDifference > 3) {
                this.player.seekTo(elapsedSeconds, true);
                this.lastSyncTime = currentTime;
                console.log(`Синхронізовано: ${elapsedSeconds.toFixed(2)}s (різниця: ${timeDifference.toFixed(2)}s)`);
            }
        }

        /**
         * Перевірка стану плеєра
         */
        checkPlayerState() {
            if (!this.player || !this.isReady) return;

            const state = this.player.getPlayerState();

            // Якщо плеєр на паузі або зупинений, спробувати відновити
            if (state === 2 || state === 5) { // PAUSED or CUED
                this.player.playVideo();
            }
        }

        /**
         * Встановлення якості відео
         */
        setQuality(quality) {
            if (!this.player || !this.isReady) return;

            const qualityLevels = {
                'auto': 'default',
                '1080p': 'hd1080',
                '720p': 'hd720',
                '480p': 'large',
                '360p': 'medium',
                '240p': 'small'
            };

            const ytQuality = qualityLevels[quality] || quality;
            this.player.setPlaybackQuality(ytQuality);
            console.log(`Якість встановлено: ${quality}`);
        }

        /**
         * Зміна відео
         */
        changeVideo(videoId, startDate = null) {
            this.config.videoId = videoId;
            
            if (startDate) {
                this.config.startDate = startDate;
                this.startTimestamp = new Date(startDate).getTime();
            }

            if (this.player && this.isReady) {
                this.stopSync();
                this.player.loadVideoById(videoId);
            }
        }

        /**
         * Відтворення
         */
        play() {
            if (this.player && this.isReady) {
                this.player.playVideo();
            }
        }

        /**
         * Пауза
         */
        pause() {
            if (this.player && this.isReady) {
                this.player.pauseVideo();
            }
        }

        /**
         * Отримання поточного часу
         */
        getCurrentTime() {
            if (!this.player || !this.isReady) return 0;
            return this.player.getCurrentTime();
        }

        /**
         * Отримання тривалості
         */
        getDuration() {
            if (!this.player || !this.isReady) return 0;
            return this.player.getDuration();
        }

        /**
         * Отримання стану плеєра
         */
        getPlayerState() {
            if (!this.player || !this.isReady) return -1;
            return this.player.getPlayerState();
        }

        /**
         * Перехід до певного часу
         */
        seekTo(seconds) {
            if (this.player && this.isReady) {
                this.player.seekTo(seconds, true);
            }
        }

        /**
         * Зміна часу відносно початку трансляції
         */
        adjustTime(hours) {
            const newTimestamp = this.startTimestamp + (hours * 3600 * 1000);
            this.startTimestamp = newTimestamp;
            this.syncToCurrentTime();
            console.log(`Час змінено на ${hours > 0 ? '+' : ''}${hours} годин`);
        }

        /**
         * Знищення плеєра
         */
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
            console.log('YouTube Sync Player знищено');
        }

        /**
         * Отримання інформації про стан
         */
        getStatus() {
            if (!this.player || !this.isReady) {
                return {
                    ready: false,
                    syncing: false,
                    state: 'not ready'
                };
            }

            const states = {
                '-1': 'не розпочато',
                '0': 'завершено',
                '1': 'відтворення',
                '2': 'пауза',
                '3': 'буферизація',
                '5': 'відео в черзі'
            };

            return {
                ready: this.isReady,
                syncing: this.isSyncing,
                state: states[this.player.getPlayerState()] || 'невідомо',
                currentTime: this.getCurrentTime(),
                duration: this.getDuration(),
                streamTime: (Date.now() - this.startTimestamp) / 1000,
                videoId: this.config.videoId
            };
        }
    }

    // Експорт бібліотеки
    if (typeof module !== 'undefined' && module.exports) {
        module.exports = YouTubeSyncPlayer;
    } else {
        window.YouTubeSyncPlayer = YouTubeSyncPlayer;
    }

})(typeof window !== 'undefined' ? window : this);
