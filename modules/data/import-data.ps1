param(
  [Parameter(Mandatory = $true)][string]$Archive,
  [string]$Destination = (Join-Path $PSScriptRoot '..\..\tmp\study-data\input')
)

$ErrorActionPreference = 'Stop'
Add-Type -AssemblyName System.IO.Compression.FileSystem
$archiveFile = [IO.Compression.ZipFile]::OpenRead((Resolve-Path -LiteralPath $Archive).Path)
$targetDirectory = [IO.Path]::GetFullPath($Destination)
$expectedFiles = @('模拟学生.csv', '题目与材料.csv', '测验节点.csv', '课程要求.csv', '作答记录.csv', '字段说明.csv')
try {
  $entries = @{}
  foreach ($name in $expectedFiles) {
    $matches = @($archiveFile.Entries | Where-Object { $_.FullName.Replace('\', '/') -eq ('赛题数据/赛题资料包/4_赛题数据/模拟学情数据/' + $name) })
    if ($matches.Count -ne 1) { throw "资料包内缺少或重复文件：$name" }
    $targetFile = Join-Path $targetDirectory $name
    if (Test-Path -LiteralPath $targetFile) { throw "拒绝覆盖已有文件：$targetFile" }
    $entries[$name] = $matches[0]
  }
  [IO.Directory]::CreateDirectory($targetDirectory) | Out-Null
  foreach ($name in $expectedFiles) {
    [IO.Compression.ZipFileExtensions]::ExtractToFile($entries[$name], (Join-Path $targetDirectory $name), $false)
  }
  Write-Output "已将六张CSV表提取到：$targetDirectory"
  Write-Output '赛事资料限本次比赛本地使用；默认tmp目录被Git忽略。'
} finally {
  $archiveFile.Dispose()
}
