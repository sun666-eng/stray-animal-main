package com.example.common;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.servlet.config.annotation.InterceptorRegistry;
import org.springframework.web.servlet.config.annotation.ResourceHandlerRegistry;
import org.springframework.web.servlet.config.annotation.WebMvcConfigurer;

import java.io.File;


@Configuration
public class WebMvcConfig implements WebMvcConfigurer {

    @Value("${file.upload-dir:upload}")
    private String uploadDir;

    @Override
    public void addInterceptors(InterceptorRegistry registry) {
        registry.addInterceptor(new AuthInterceptor())
                .addPathPatterns("/api/**", "/page/**")
                .excludePathPatterns(
                    "/api/user/login",
                    "/api/user/register",
                    "/page/end/login.html",
                    "/page/end/register.html",
                    "/page/front/login.html",
                    "/page/front/animal_browse.html",
                    "/page/front/animal_detail.html",
                    "/page/front/notice_list.html",
                    "/page/front/notice_detail.html"
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
