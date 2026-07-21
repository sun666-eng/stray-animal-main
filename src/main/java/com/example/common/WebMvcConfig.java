package com.example.common;

import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;

@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;
    private final FileStorage fileStorage;

    public WebMvcConfig(AuthInterceptor authInterceptor, FileStorage fileStorage) {
        this.authInterceptor = authInterceptor;
        this.fileStorage = fileStorage;
    }

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**", "/page/**")
                .excludePathPatterns(
                    "/api/user/login",
                    "/api/user/register",
                    "/page/end",
                    "/page/end/",
                    "/page/end/login.html",
                    "/page/end/register.html",
                    "/page/front",
                    "/page/front/",
                    "/page/front/login.html",
                    "/page/front/register.html",
                    "/page/front/animal_browse.html",
                    "/page/front/animal_detail.html",
                    "/page/front/notice_list.html",
                    "/page/front/notice_detail.html",
                    "/page/front/account_public.html"
                );
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        File dir = fileStorage.getRootFile();
        if (!dir.isDirectory()) {
            //noinspection ResultOfMethodCallIgnored
            dir.mkdirs();
        }
        String location = "file:" + fileStorage.getRootAbsolutePath() + File.separator;
        registry.addResourceHandler("/file/**")
                .addResourceLocations(location);
    }
}
