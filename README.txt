vwFactory for DeepSeek Harness (DSH 插件)
=========================================

功能
  - Factory 多账号管理 + 本机协议代理 (127.0.0.1:4199, OpenAI / Anthropic / Responses 兼容)
  - 无感切号: 当前账号额度用尽或报错 (401/402/403/429) 时自动换号重试，出错账号自动冷却
  - 多账号均衡 (可选): 设置里把「分配方式」切到「均衡」，每个对话固定一个账号 (保留缓存)，
    新对话分给剩余额度最多的账号；额度到 75% / 90% / 用完时弹出提醒
  - 额度一目了然:
      * 输入框下方的额度胶囊 (只在使用 Factory 模型时显示)，点开看全部账号、一键切换
      * DSH 设置 -> Factory 账号: 添加 / 切换 / 删除账号、额度圆环、模型倍率
      * 右侧栏新建标签页 -> 「Factory 额度」 (可选)

使用教程
  一、安装插件
    1. 下载 DeepSeek Harness 并启动一次 (一定要启动一次，否则 DSH 配置文件夹还没创建)
    2. 解压压缩包 (不要直接在压缩包里双击)
    3. 双击 install.bat (DSH 正在运行时会询问是否自动重启，直接回车)

  二、添加 Factory 的 API Key
    1. Factory 官网 -> Settings -> API Keys -> Create Key，名字随便起，日期不用选
    2. 复制 Key，打开 DSH -> 设置 -> Factory 账号 -> 添加账号，按 邮箱----Key 填入
       (邮箱只用来区分账号；每行一个，可以一次加多个)
       也可以像旧版一样，在 DSH 运行时用浏览器打开 http://127.0.0.1:4199/ 导入

  三、开始用
    在输入框右侧的模型选择里，选 Factory (Claude) / Factory (GPT) / Factory (Grok) / Factory 下的模型

  更新: DSH 设置 -> Factory 账号 -> 插件版本 -> 点「更新」，然后重启 DSH
        (也可以下载新压缩包、解压、再双击 install.bat，账号保留)

卸载
  双击 uninstall.bat (账号数据默认保留; 命令行加 -RemoveData 可一并删除)

脚本做了什么
  - 复制插件到 %USERPROFILE%\.dsh\profiles\desktop\plugins\vwFactory
  - 生成/沿用本机令牌 %USERPROFILE%\.vwFactory\local-token，写入用户环境变量和 DSH 凭据 (VWFACTORY_TOKEN)
  - 刷新 cordis.patch.yml 里由本脚本管理的两段配置 (vwfactory:mount / vwfactory:providers)，
    你自己写的其它配置不动；改动前自动备份为 cordis.patch.yml.bak-时间戳 (保留最近 5 份)
  - 压缩包里不包含任何账号或 key；你的 key 只保存在你自己电脑的
    %USERPROFILE%\.vwFactory\secrets.json (用你的 Windows 账户加密，换电脑或换用户无法解开，请勿外传)
  - 数据目录 ~/.vwFactory 与 DSH 目录分开，重置 DSH 不会丢账号

常见问题
  - 双击后窗口一闪而过 / 提示禁止运行脚本: 右键 install.bat -> 以管理员身份运行，
    或在 PowerShell 里执行: powershell -ExecutionPolicy Bypass -File install.ps1
  - 设置里没有「Factory 账号」: 确认已完全退出 DSH (托盘图标也要退出) 后重新打开
  - 你的 cordis.patch.yml 已有自定义的 llm-pi-ai 段: 脚本不会改它，会提示你把
    templates\llm-pi-ai.yml 里的三个 provider 手动合并进去
  - 多个 DSH 配置目录 / 自定义目录:
    powershell -ExecutionPolicy Bypass -File install.ps1 -ProfileDir "路径"
  - 免询问安装 (自动关闭并重启 DSH): install.bat -Yes ；不关闭 DSH: install.bat -NoRestart

注意
  - 本项目与 Factory.ai 官方无关，使用你的账号需自行遵守其服务条款。

项目主页 / 下载最新版: https://github.com/cjj66619/vwfactory-dsh/releases
