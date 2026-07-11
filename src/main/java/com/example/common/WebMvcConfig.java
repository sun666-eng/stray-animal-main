package com.example.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;


@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    private final AuthInterceptor authInterceptor;

    public WebMvcConfig(AuthInterceptor authInterceptor) {
        this.authInterceptor = authInterceptor;
    }

    @Value("${file.upload-dir:upload}")
    private String uploadDir;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(authInterceptor)
                .addPathPatterns("/api/**", "/page/**")
                .excludePathPatterns(
                    "/api/user/login",
                    "/api/user/register",
                    "/page/end",
                    "/page/end/",
                    // 旧管理端登录路径：由 PageController 301 到统一登录页，需放行拦截器
                    "/page/end/login.html",
                    "/page/end/register.html",
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
    }

    @Override
    public void addResourceHandlers(ResourceHandlerRegistry registry) {
        File dir = new File(uploadDir);
        if (!dir.isDirectory()) {
            dir.mkdirs();
        }
        registry.addResourceHandler("/file/**")
                .addResourceLocations("file:" + dir.getAbsolutePath() + File.separator);
    }
}
