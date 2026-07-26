package com.example.config;

import com.alibaba.druid.pool.DruidDataSource;
import lombok.extern.slf4j.Slf4j;
import org.springframework.boot.context.properties.ConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

import javax.sql.DataSource;

/**
 * 崩溃预防 P0.1（docs/crash-hardening-plan.md）：druid 连接池显式参数。
 *
 * <p>为什么必须自定义 Bean（勿删本类改回 yml 直配）：
 * <ul>
 *   <li>本项目只有 druid 核心包、无 starter；Spring Boot 3 不再从 spring.factories
 *       读自动配置，本地 m2 的 druid-spring-boot-starter 1.2.19 在 SB3 下不生效；</li>
 *   <li>因此 {@code spring.datasource.druid.*} 前缀在 SB 3.4.5 下**静默失效**
 *       （autoconfigure 元数据已核实无该前缀）；</li>
 *   <li>默认的 Generic DataSourceBuilder 只绑定 url/driver/username/password 四个键，
 *       连接池参数一律到不了 DruidDataSource——默认 maxActive=8、maxWait=-1（无限等待，
 *       字节码已核实），并发稍高即全站假死且无异常日志。</li>
 * </ul>
 * 本 Bean 用 {@code @ConfigurationProperties(prefix = "spring.datasource")} 宽松绑定,
 * yml 里的 kebab-case 键（max-active/max-wait/keep-alive 等）直达 druid setter。
 * 无需配置的项（已核实默认为安全值）：test-while-idle=true、MySQL ping 校验自动启用。
 */
@Slf4j
@Configuration
public class DataSourceConfig {

    @Bean(initMethod = "init", destroyMethod = "close")
    @ConfigurationProperties(prefix = "spring.datasource")
    public DataSource dataSource() {
        DruidDataSource ds = new DruidDataSource();
        log.info("使用显式 DruidDataSource（连接池参数经 spring.datasource.* 宽松绑定）");
        return ds;
    }
}
