param([string]$OutputFile = '')

$ErrorActionPreference = 'Stop'
$repositoryRoot = [System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'))
$reportsRoot = [System.IO.Path]::GetFullPath((Join-Path $repositoryRoot 'reports'))

if (-not $OutputFile) {
  $OutputFile = Join-Path $reportsRoot 'autonomy-log-index.json'
}

$destination = [System.IO.Path]::GetFullPath($OutputFile)
$reportsPrefix = $reportsRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
if (-not $destination.StartsWith($reportsPrefix, [System.StringComparison]::OrdinalIgnoreCase)) {
  throw 'Output must remain under reports.'
}

$entries = @()
foreach ($directory in @('results', 'reports')) {
  $sourceRoot = Join-Path $repositoryRoot $directory
  if (-not (Test-Path -LiteralPath $sourceRoot -PathType Container)) { continue }

  Get-ChildItem -LiteralPath $sourceRoot -File -ErrorAction SilentlyContinue |
    Sort-Object LastWriteTimeUtc -Descending |
    Select-Object -First 10 |
    ForEach-Object {
      if ([System.IO.Path]::GetFullPath($_.FullName) -eq $destination) { return }
      $rootPrefix = $repositoryRoot.TrimEnd([System.IO.Path]::DirectorySeparatorChar) + [System.IO.Path]::DirectorySeparatorChar
      $relativePath = $_.FullName.Substring($rootPrefix.Length).Replace('\', '/')
      $entries += [ordered]@{
        path = $relativePath
        bytes = $_.Length
        sha256 = (Get-FileHash -LiteralPath $_.FullName -Algorithm SHA256).Hash.ToLowerInvariant()
        lastModifiedUtc = $_.LastWriteTimeUtc.ToString('o')
      }
    }
}

$manifest = [ordered]@{
  schemaVersion = 1
  contentCopied = $false
  description = 'Metadata-only index; source result and report contents remain in place.'
  entries = $entries
  generatedAt = (Get-Date).ToUniversalTime().ToString('o')
}

New-Item -ItemType Directory -Path $reportsRoot -Force | Out-Null
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $destination -Encoding utf8
$manifest | ConvertTo-Json -Depth 5 -Compress

