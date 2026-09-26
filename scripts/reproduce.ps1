param([string]$TestPath='tests/json-recovery.test.mjs')
$ErrorActionPreference='Stop';. (Join-Path $PSScriptRoot 'resolve-node.ps1');$node=Resolve-ResearchNode;$root=[System.IO.Path]::GetFullPath((Join-Path $PSScriptRoot '..'));Push-Location $root;try{& $node --test $TestPath;exit $LASTEXITCODE}finally{Pop-Location}
