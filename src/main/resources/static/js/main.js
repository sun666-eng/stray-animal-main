import axios from 'axios'
import vue from 'vue'


axios.interceptors.request.use(
    config => {
        // Session 权威：仅 CSRF，不发送 JWT
        const method = (config.method || 'get').toLowerCase();
        if (method !== 'get' && method !== 'head' && method !== 'options') {
            const csrf = sessionStorage.getItem('csrfToken');
            if (csrf) {
                config.headers['X-CSRF-Token'] = csrf;
            }
        }
        if (config.url.indexOf(url) === -1) {
            config.url = url + config.url;/*拼接完整请求路径*/
        }
        return config;
    },
    err => {
        return Promise.reject(err);
    });
