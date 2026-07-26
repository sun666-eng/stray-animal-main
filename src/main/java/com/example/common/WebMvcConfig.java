package com.example.common;

import org.springframework.context.annotation.Configuration;
import org.springframework.http.CacheControl;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;
import java.time.Duration;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final CsrfInterceptor csrfInterceptor;
    private final FileStorage fileStorage;

    public WebMvcConfig(AuthInterceptor authInterceptor, CsrfInterceptor csrfInterceptor, FileStorage fileStorage) {
        this.authInterceptor = authInterceptor;
        this.csrfInterceptor = csrfInterceptor;
        this.fileStorage = fileStorage;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**", "/page/**", "/prototype.html")
                .excludePathPatterns(
                    "/api/user/login",
                    "/api/user/register",
                    "/page/end",
                    "/page/end/",
                    "/page/end/login.html",
                    "/page/front",
                    "/page/front/",
                    "/page/front/login.html",
                    "/page/front/register.html",
                    "/page/front/index.html",
                    "/page/front/animal_browse.html",
                    "/page/front/animal_detail.html",
                    "/page/front/notice_list.html",
                    "/page/front/notice_detail.html",
                    "/page/front/account_public.html"
                );
        // A0.8：鉴权之后校验 CSRF（登录/注册在拦截器内豁免）
        registry.addInterceptor(csrfInterceptor)
                .addPathPatterns("/api/**")
                .order(1);
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        // 前端优化 P0：静态资源缓存策略。
        // js/css/静态图可长缓存（自有 js/css 以统一 ?v= 版本串失效，发版须 bump——见 docs/frontend-optimization-plan.md）；
        // HTML 用 no-cache 强制协商（Last-Modified 304），保证页面结构改动即时可见。
        registry.addResourceHandler("/js/**")
                .addResourceLocations("classpath:/static/js/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(7)));
        registry.addResourceHandler("/css/**")
                .addResourceLocations("classpath:/static/css/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(7)));
        registry.addResourceHandler("/prototype-assets/**")
                .addResourceLocations("classpath:/static/prototype-assets/")
                .setCacheControl(CacheControl.maxAge(Duration.ofDays(7)));
        registry.addResourceHandler("/page/**")
                .addResourceLocations("classpath:/static/page/")
                .setCacheControl(CacheControl.noCache());

        // B3-F：不再把上传根目录直接映射到 /file/**，防止绕过 FileController 鉴权。
        // 所有业务文件统一走 /api/files/{flag}。
        // 如需公开静态图，请放到 classpath:/static/ 或独立 public 目录，勿映射私有 upload。
        File dir = fileStorage.getRootFile();
        if (!dir.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
    }
}
