function Resolve-ResearchNode {
  $command=Get-Command node -ErrorAction SilentlyContinue;if($command){return $command.Source}
  $runtimeRoot=Join-Path $env:LOCALAPPDATA 'OpenAI\Codex\runtimes';$node=Get-ChildItem -LiteralPath $runtimeRoot -Filter node.exe -Recurse -File -ErrorAction SilentlyContinue|Sort-Object LastWriteTime -Descending|Select-Object -First 1 -ExpandProperty FullName;if($node){return $node};throw 'Node.js 22+ was not found.'
}
