/**
 * Stream Key Manager v1.0.0
 * Система управления ключами доступа к персонализированным плейлистам
 */
(function(window) {
'use strict';

class StreamKeyManager {
    constructor(config = {}) {
        this.config = {
            // URL базы данных ключей
            keysDatabaseUrl: config.keysDatabaseUrl || 'keys.json',
            
            // Резервный плейлист для гостей
            guestPlaylistUrl: config.guestPlaylistUrl || 'guest.json',
            
            // Источник ключа: 'url', 'localStorage', 'cookie', 'manual'
            keySource: config.keySource || 'url',
            
            // Название параметра в URL
            keyParamName: config.keyParamName || 'stream_key',
            
            // Название ключа в localStorage
            keyStorageName: config.keyStorageName || 'stream_access_key',
            
            // Кэширование ключей (минуты)
            cacheDuration: config.cacheDuration || 60
        };
        
        this.keysCache = null;
        this.cacheTimestamp = null;
        this.currentKey = null;
        this.currentPlaylistUrl = null;
    }
    
    /**
     * Получение ключа из выбранного источника
     */
    getKey() {
        let key = null;
        
        switch(this.config.keySource) {
            case 'url':
                key = this.getKeyFromURL();
                break;
            case 'localStorage':
                key = this.getKeyFromStorage();
                break;
            case 'cookie':
                key = this.getKeyFromCookie();
                break;
            case 'manual':
                key = this.currentKey;
                break;
        }
        
        return key;
    }
    
    /**
     * Получение ключа из URL параметра
     */
    getKeyFromURL() {
        const urlParams = new URLSearchParams(window.location.search);
        return urlParams.get(this.config.keyParamName);
    }
    
    /**
     * Получение ключа из localStorage
     */
    getKeyFromStorage() {
        return localStorage.getItem(this.config.keyStorageName);
    }
    
    /**
     * Получение ключа из cookie
     */
    getKeyFromCookie() {
        const name = `${this.config.keyStorageName}=`;
        const decodedCookie = decodeURIComponent(document.cookie);
        const ca = decodedCookie.split(';');
        for(let i = 0; i < ca.length; i++) {
            let c = ca[i];
            while (c.charAt(0) === ' ') {
                c = c.substring(1);
            }
            if (c.indexOf(name) === 0) {
                return c.substring(name.length, c.length);
            }
        }
        return null;
    }
    
    /**
     * Установка ключа вручную
     */
    setKey(key) {
        this.currentKey = key;
        
        // Сохраняем в выбранное хранилище
        if (this.config.keySource === 'localStorage') {
            localStorage.setItem(this.config.keyStorageName, key);
        } else if (this.config.keySource === 'cookie') {
            document.cookie = `${this.config.keyStorageName}=${key};max-age=${365*24*60*60};path=/`;
        }
    }
    
    /**
     * Загрузка базы данных ключей с кэшированием
     */
    async loadKeysDatabase() {
        // Проверяем кэш
        if (this.keysCache && this.cacheTimestamp) {
            const now = Date.now();
            const cacheAge = (now - this.cacheTimestamp) / (60 * 1000); // в минутах
            
            if (cacheAge < this.config.cacheDuration) {
                console.log('Используем кэшированные ключи');
                return this.keysCache;
            }
        }
        
        try {
            const response = await fetch(this.config.keysDatabaseUrl);
            if (!response.ok) {
                throw new Error('Не удалось загрузить базу ключей');
            }
            
            this.keysCache = await response.json();
            this.cacheTimestamp = Date.now();
            
            console.log('База ключей загружена');
            return this.keysCache;
            
        } catch (error) {
            console.error('Ошибка загрузки базы ключей:', error);
            return null;
        }
    }
    
    /**
     * Получение плейлиста по ключу
     */
    async getPlaylistUrl() {
        const key = this.getKey();
        
        // Если ключа нет - возвращаем гостевой плейлист
        if (!key) {
            console.log('Ключ не найден, используем гостевой плейлист');
            this.currentPlaylistUrl = this.config.guestPlaylistUrl;
            return this.currentPlaylistUrl;
        }
        
        // Загружаем базу ключей
        const keysDatabase = await this.loadKeysDatabase();
        if (!keysDatabase) {
            console.warn('База ключей недоступна, используем гостевой плейлист');
            this.currentPlaylistUrl = this.config.guestPlaylistUrl;
            return this.currentPlaylistUrl;
        }
        
        // Ищем ключ в базе
        const playlistConfig = keysDatabase.playlists.find(p => p.key === key);
        
        if (playlistConfig) {
            console.log(`Найден плейлист: ${playlistConfig.name}`);
            this.currentPlaylistUrl = playlistConfig.url;
            return this.currentPlaylistUrl;
        } else {
            console.warn('Ключ не найден в базе, используем гостевой плейлист');
            this.currentPlaylistUrl = this.config.guestPlaylistUrl;
            return this.currentPlaylistUrl;
        }
    }
    
    /**
     * Проверка валидности ключа
     */
    async validateKey(key) {
        const keysDatabase = await this.loadKeysDatabase();
        if (!keysDatabase) return false;
        
        return keysDatabase.playlists.some(p => p.key === key);
    }
    
    /**
     * Получение информации о текущем ключе
     */
    async getKeyInfo() {
        const key = this.getKey();
        if (!key) return { type: 'guest', name: 'Гость' };
        
        const keysDatabase = await this.loadKeysDatabase();
        if (!keysDatabase) return { type: 'guest', name: 'Гость' };
        
        const playlistConfig = keysDatabase.playlists.find(p => p.key === key);
        if (!playlistConfig) return { type: 'guest', name: 'Гость' };
        
        return {
            type: 'authenticated',
            name: playlistConfig.name,
            description: playlistConfig.description || '',
            key: key
        };
    }
    
    /**
     * Очистка кэша
     */
    clearCache() {
        this.keysCache = null;
        this.cacheTimestamp = null;
    }
    
    /**
     * Очистка ключа
     */
    clearKey() {
        this.currentKey = null;
        
        if (this.config.keySource === 'localStorage') {
            localStorage.removeItem(this.config.keyStorageName);
        } else if (this.config.keySource === 'cookie') {
            document.cookie = `${this.config.keyStorageName}=;max-age=0;path=/`;
        }
    }
}

// Экспорт
if (typeof module !== 'undefined' && module.exports) {
    module.exports = StreamKeyManager;
} else {
    window.StreamKeyManager = StreamKeyManager;
}

})(typeof window !== 'undefined' ? window : this);
