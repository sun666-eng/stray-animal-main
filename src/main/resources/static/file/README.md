# 此目录已清空敏感上传历史

历史用户上传（身份证等）已移至项目根目录 `legacy-uploads/`，
**不得**放在 `classpath:/static/**` 下，否则会通过 /file/** 匿名暴露。

公开轮播图已移至 `static/img-public/`。
业务读文件统一走 `/api/files/{flag}`。
