/**
 * UB-STUDIOZ Global Cloud API SDK
 */
class UBCloud {
    constructor(apiKey, baseUrl = 'https://ubstudioz.duckdns.org') {
        this.apiKey = apiKey;
        this.baseUrl = baseUrl;
    }

    async _request(endpoint, method = 'GET', body = null, isRaw = false) {
        const url = new URL(`${this.baseUrl}${endpoint}`);
        if (!url.searchParams.has('key')) url.searchParams.append('key', this.apiKey);

        const options = {
            method,
            headers: { 'x-api-key': this.apiKey }
        };

        if (body && !isRaw) {
            options.headers['Content-Type'] = 'application/json';
            options.body = JSON.stringify(body);
        } else if (body && isRaw) {
            options.body = body;
        }

        const response = await fetch(url, options);
        const text = await response.text();
        if (!response.ok) throw new Error(text || response.statusText);
        
        try { return JSON.parse(text); } 
        catch (e) { return { message: text }; }
    }

    async _notifySDK(action, details = "") {
        try {
            await this._request('/api/notify-action', 'POST', { action, details });
        } catch (e) {
            console.warn('⚠️ SDK Notification failed:', e.message);
        }
    }

    async notifyVisit() {
        return this._notifySDK('visit');
    }

    notifyExit() {
        // Use sendBeacon for reliable notification when the page is closing
        const url = new URL(`${this.baseUrl}/api/notify-action`);
        url.searchParams.append('key', this.apiKey);
        const data = JSON.stringify({ action: 'exit' });
        navigator.sendBeacon(url, data);
    }

    async listFiles(path = "") {
        this._notifySDK('listFiles', `path: ${path}`);
        return this._request(`/api/files?path=${encodeURIComponent(path)}`, 'GET');
    }

    async upload(file, path = "") {
        this._notifySDK('upload', `file: ${file.name}, path: ${path}`);
        const formData = new FormData();
        formData.append('file', file);
        return this._request(`/upload?path=${encodeURIComponent(path)}`, 'POST', formData, true);
    }

    async delete(name, path = "") {
        this._notifySDK('delete', `${name} in ${path}`);
        const names = Array.isArray(name) ? name : [name];
        const params = new URLSearchParams();
        names.forEach(n => params.append('name', n));
        params.append('path', path);
        params.append('key', this.apiKey);
        return this._request(`/api/delete?${params.toString()}`, 'DELETE');
    }

    async rename(oldName, newName, path = "") {
        this._notifySDK('rename', `${oldName} -> ${newName} in ${path}`);
        return this._request('/api/rename', 'POST', { oldName, newName, path });
    }

    async create(type, name, path = "") {
        this._notifySDK(`create ${type}`, `${name} in ${path}`);
        const endpoint = type === 'folder' ? '/api/create-folder' : '/api/create-file';
        return this._request(endpoint, 'POST', { name, path });
    }

    async copy(sourceName, sourcePath, destPath) {
        this._notifySDK('copy', `${sourceName} from ${sourcePath} to ${destPath}`);
        return this._request('/api/copy', 'POST', { sourceName, sourcePath, destPath });
    }

    async move(sourceName, sourcePath, destPath, isFromTrash = false) {
        this._notifySDK('move', `${sourceName} to ${destPath} (fromTrash: ${isFromTrash})`);
        return this._request('/api/move', 'POST', { sourceName, sourcePath, destPath, isFromTrash });
    }

    async save(name, path, content) {
        this._notifySDK('save', `${name} in ${path}`);
        return this._request('/api/save-file', 'POST', { name, path, content });
    }

    async transcode(name, path = "") {
        this._notifySDK('transcode', `${name} in ${path}`);
        return this._request('/api/transcode', 'POST', { name, path });
    }

    async processImage(name, path, options) {
        this._notifySDK('processImage', `${name} in ${path}`);
        return this._request('/api/process-image', 'POST', { name, path, ...options });
    }

    getViewUrl(name, path = "") {
        return `${this.baseUrl}/view/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}&key=${this.apiKey}`;
    }

    getDownloadUrl(name, path = "") {
        return `${this.baseUrl}/download/${encodeURIComponent(name)}?path=${encodeURIComponent(path)}&key=${this.apiKey}`;
    }
}