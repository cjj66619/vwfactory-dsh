# vwFactory for DeepSeek Harness - 一键安装 / 更新
# 用法: 双击 install.bat；更新时下载新版压缩包后同样双击 install.bat (账号数据保留)。
#   powershell -ExecutionPolicy Bypass -File install.ps1 [-ProfileDir 路径] [-Yes] [-NoRestart] [-SkipEnv]
#   -Yes        不询问，直接关闭并重启正在运行的 DSH
#   -NoRestart  不关闭 DSH (装完需自己重启)
param(
  [string]$ProfileDir,
  [switch]$Yes,
  [switch]$NoRestart,
  [switch]$SkipEnv
)
$ErrorActionPreference = "Stop"
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$utf8 = New-Object System.Text.UTF8Encoding $false
$stamp = Get-Date -Format "yyyyMMdd-HHmmss"

function Info($m) { Write-Host "[vwFactory] $m" }
function Ok($m) { Write-Host "[vwFactory] $m" -ForegroundColor Green }
function Read-Version($pkgFile) {
  if (-not (Test-Path $pkgFile)) { return $null }
  try { return ([IO.File]::ReadAllText($pkgFile, $utf8) | ConvertFrom-Json).version } catch { return "?" }
}
function Prune-Backups($file, [int]$keep = 5) {
  $dir = Split-Path -Parent $file; $name = Split-Path -Leaf $file
  if (-not (Test-Path $dir)) { return }
  Get-ChildItem $dir -File -Filter "$name.bak-*" | Sort-Object Name -Descending | Select-Object -Skip $keep |
    ForEach-Object { Remove-Item $_.FullName -Force }
}
# 去掉本脚本托管的配置段 (与 uninstall.ps1 相同的规则)
function Remove-ManagedBlocks([string[]]$lines) {
  $out = New-Object System.Collections.Generic.List[string]
  $i = 0
  while ($i -lt $lines.Length) {
    $ln = $lines[$i]
    if ($ln -like "# >>> vwfactory:mount*") {
      while ($i -lt $lines.Length -and $lines[$i] -notlike "# <<< vwfactory:mount*") { $i++ }
      $i++
      if ($i -lt $lines.Length -and $lines[$i].Trim() -eq "") { $i++ }
      continue
    }
    if ($ln -like "# >>> vwfactory:providers*") {
      $i++
      if ($i -lt $lines.Length) { $i++ }
      while ($i -lt $lines.Length -and $lines[$i] -notmatch "^- ") { $i++ }
      continue
    }
    $out.Add($ln); $i++
  }
  return ,$out.ToArray()
}

# ---------- 0. 版本与目录 ----------
$newVer = Read-Version (Join-Path $here "plugin\package.json")
Write-Host ""
Write-Host "  vwFactory for DeepSeek Harness  v$newVer" -ForegroundColor Cyan
Write-Host ""

if (-not $ProfileDir) {
  $profiles = Join-Path $env:USERPROFILE ".dsh\profiles"
  $desktop = Join-Path $profiles "desktop"
  if (Test-Path $desktop) { $ProfileDir = $desktop }
  elseif (Test-Path $profiles) {
    $cands = @(Get-ChildItem $profiles -Directory)
    if ($cands.Count -eq 1) { $ProfileDir = $cands[0].FullName }
    elseif ($cands.Count -gt 1) {
      throw "发现多个 DSH 配置目录: $(($cands | ForEach-Object Name) -join ', ')`n请用 -ProfileDir 指定，例如: install.ps1 -ProfileDir `"$($cands[0].FullName)`""
    }
  }
}
if (-not $ProfileDir -or -not (Test-Path $ProfileDir)) {
  throw "找不到 DSH 配置目录 (~/.dsh/profiles/desktop)。`n请先安装并至少启动一次 DeepSeek Harness，或用 -ProfileDir 指定目录。"
}
$dest = Join-Path $ProfileDir "plugins\vwFactory"
$oldVer = Read-Version (Join-Path $dest "package.json")
if ($oldVer -eq $newVer) { Info "已是 v$newVer，重新安装 (账号数据保留)" }
elseif ($oldVer) { Info "检测到已安装 v$oldVer -> 更新到 v$newVer (账号数据保留)" }
else { Info "全新安装 v$newVer" }
Info "配置目录: $ProfileDir"

# ---------- 1. 处理正在运行的 DSH ----------
$restartExe = $null
$procs = @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue)
if ($procs.Count -gt 0) {
  $exe = ($procs | Where-Object { $_.Path } | Select-Object -First 1).Path
  $doClose = $false
  if ($NoRestart) {
    Write-Warning "DeepSeek Harness 正在运行；安装完成后请手动完全退出并重新打开。"
  } elseif ($Yes) {
    $doClose = $true
  } else {
    $ans = Read-Host "[vwFactory] DeepSeek Harness 正在运行，需要重启才能生效。现在自动关闭、装完后重新打开? [Y/n]"
    $doClose = ($ans -eq "" -or $ans -match '^[yY]')
    if (-not $doClose) { Write-Warning "不关闭 DSH 继续安装；装完请手动完全退出并重新打开。" }
  }
  if ($doClose) {
    Info "正在关闭 DeepSeek Harness ..."
    foreach ($p in $procs) { if ($p.MainWindowHandle -ne 0) { [void]$p.CloseMainWindow() } }
    $deadline = (Get-Date).AddSeconds(15)
    while ((Get-Date) -lt $deadline -and @(Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue).Count -gt 0) { Start-Sleep -Milliseconds 500 }
    Get-Process -Name "DeepSeek Harness" -ErrorAction SilentlyContinue | Stop-Process -Force -ErrorAction SilentlyContinue
    Start-Sleep -Milliseconds 800
    $restartExe = $exe
    if (-not $restartExe) {
      $guess = Join-Path $env:LOCALAPPDATA "Programs\DeepSeek Harness\DeepSeek Harness.exe"
      if (Test-Path $guess) { $restartExe = $guess }
    }
    Ok "DeepSeek Harness 已关闭"
  }
}

# ---------- 2. 复制插件 ----------
New-Item -ItemType Directory -Force $dest | Out-Null
Copy-Item (Join-Path $here "plugin\*") $dest -Recurse -Force
Ok "插件文件已更新: $dest"

# ---------- 3. 本机令牌 (~/.vwFactory/local-token): 已有则沿用 ----------
$tokDir = Join-Path $env:USERPROFILE ".vwFactory"
$tokFile = Join-Path $tokDir "local-token"
$token = $null
if (Test-Path $tokFile) { $token = ([IO.File]::ReadAllText($tokFile, $utf8)).Trim() }
if (-not $token -or -not $token.StartsWith("fbk-")) {
  $rng = [System.Security.Cryptography.RandomNumberGenerator]::Create()
  $bytes = New-Object byte[] 24
  $rng.GetBytes($bytes)
  $token = "fbk-" + (-join ($bytes | ForEach-Object { $_.ToString("x2") }))
  New-Item -ItemType Directory -Force $tokDir | Out-Null
  [IO.File]::WriteAllText($tokFile, $token, $utf8)
  Info "已生成本机令牌: $tokFile"
} else {
  Info "沿用已有本机令牌"
}

# ---------- 4. 环境变量 + DSH 凭据 (模型提供方 apiKeyEnv=VWFACTORY_TOKEN) ----------
if (-not $SkipEnv) {
  [Environment]::SetEnvironmentVariable("VWFACTORY_TOKEN", $token, "User")
}
$dshRoot = Split-Path -Parent (Split-Path -Parent $ProfileDir)
$credFile = Join-Path $dshRoot ".credentials.yaml"
$refLine = "  VWFACTORY_TOKEN: $token"
if (Test-Path $credFile) {
  $cl = New-Object System.Collections.Generic.List[string]
  $cl.AddRange([string[]][IO.File]::ReadAllLines($credFile, $utf8))
  $hit = -1; $refs = -1
  for ($k = 0; $k -lt $cl.Count; $k++) {
    if ($cl[$k] -match '^\s+VWFACTORY_TOKEN:') { $hit = $k; break }
    if ($refs -lt 0 -and $cl[$k] -match '^refs:\s*(\{\s*\})?\s*$') { $refs = $k }
  }
  if ($hit -ge 0 -and $cl[$hit] -eq $refLine) {
    # 已是最新，不改动
  } else {
    Copy-Item $credFile "$credFile.bak-$stamp"
    if ($hit -ge 0) { $cl[$hit] = $refLine }
    elseif ($refs -ge 0) { $cl[$refs] = "refs:"; $cl.Insert($refs + 1, $refLine) }
    else { $cl.Add("refs:"); $cl.Add($refLine) }
    [IO.File]::WriteAllText($credFile, (($cl -join "`n").TrimEnd() + "`n"), $utf8)
    Prune-Backups $credFile
  }
} else {
  New-Item -ItemType Directory -Force $dshRoot | Out-Null
  [IO.File]::WriteAllText($credFile, "version: 1`nrefs:`n$refLine`n", $utf8)
}
Ok "令牌已写入环境变量与 DSH 凭据"

# ---------- 5. cordis.patch.yml: 刷新托管段 ----------
$patch = Join-Path $ProfileDir "cordis.patch.yml"
$original = ""
if (Test-Path $patch) { $original = [IO.File]::ReadAllText($patch, $utf8) }
$lines = if ($original) { $original -split "\r?\n" } else { @() }
# 新版 DSH 生成的默认文件以 "[]" (空数组) 结尾；与下面追加的 "- ..." 条目混在一起是非法 YAML，
# DSH 会启动失败。先去掉顶层的 "[]"，最后如果一个条目都没有再补回去。
$body = ((Remove-ManagedBlocks $lines) | Where-Object { $_ -notmatch '^\[\s*\]\s*(#.*)?$' }) -join "`n"
$nl = "`n"

if ($body -match "vwFactory/index\.js") {
  Info "检测到手动挂载的 vwFactory，保留你的挂载配置。"
  $mount = ""
} else {
  $mount = @(
    "# >>> vwfactory:mount (managed by install.ps1) >>>",
    "- insert:",
    "    - id: vwfactory",
    "      name: `"./plugins/vwFactory/index.js`"",
    "",
    "    - id: vwfactory-mcp",
    "      name: `"@deepseek-ai/dsh-mcp-client`"",
    "      config:",
    "        serverName: vwfactory",
    "        transport: streamable-http",
    "        url: http://127.0.0.1:4199/mcp",
    "        headers:",
    "          Authorization: `"Bearer $token`"",
    "        failOnStartupError: false",
    "# <<< vwfactory:mount <<<",
    ""
  ) -join $nl
}

$providers = ""
if ($body -match "(?m)^- id: llm-pi-ai\s*$") {
  Write-Warning "你的配置里已有自定义的 llm-pi-ai 段，脚本不会改动它。"
  Write-Warning "请手动把 templates\llm-pi-ai.yml 里的 factory-claude / factory-gpt / factory-grok / factory 四个 provider 合并进去。"
} else {
  $tpl = [IO.File]::ReadAllText((Join-Path $here "templates\llm-pi-ai.yml"), $utf8).Replace("`r`n", "`n").TrimEnd()
  $providers = $nl + $nl + "# >>> vwfactory:providers (managed by install.ps1) >>>" + $nl + $tpl + $nl
}

$text = ($mount + $nl + $body.Trim()).TrimStart("`n") 
$text = $text.TrimEnd() + $providers
if ($text -notmatch "(?m)^- ") { $text = $text.TrimEnd() + $nl + "[]" }
if (-not $text.EndsWith("`n")) { $text += "`n" }
if ($text -ne $original) {
  $hadPatch = Test-Path $patch
  if ($hadPatch) { Copy-Item $patch "$patch.bak-$stamp"; Prune-Backups $patch }
  [IO.File]::WriteAllText($patch, $text, $utf8)
  if ($hadPatch) { Ok "已刷新 cordis.patch.yml (插件挂载 / MCP / 模型提供方)，原文件已备份" }
  else { Ok "已创建 cordis.patch.yml (插件挂载 / MCP / 模型提供方)" }
} else {
  Info "cordis.patch.yml 已是最新"
}

# ---------- 6. 完成 ----------
Write-Host ""
if ($restartExe) {
  Start-Process -FilePath $restartExe
  Ok "已重新打开 DeepSeek Harness"
}
if ($oldVer -eq $newVer) {
  Ok "重新安装完成 v$newVer"
} elseif ($oldVer) {
  Ok "更新完成: v$oldVer -> v$newVer"
} else {
  Ok "安装完成 v$newVer。下一步:"
  Write-Host "  1. $(if ($restartExe) { 'DSH 已自动重启' } else { '完全退出并重新打开 DeepSeek Harness' })"
  Write-Host "  2. 打开 DSH 设置 -> Factory 账号，添加你自己的账号 (每行: 邮箱----fk-key)"
  Write-Host "  3. 在输入框右侧的模型选择里选 Factory (Claude) / Factory (GPT) / Factory (Grok) / Factory 下的模型"
}
if (-not $restartExe -and $oldVer) { Write-Host "  请完全退出并重新打开 DeepSeek Harness 使更新生效。" }
