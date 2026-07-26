package com.example.common;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;

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
