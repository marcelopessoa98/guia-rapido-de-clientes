param(
  [string]$Source = ".\source-clientes.xlsx",
  [string]$Output = ".\seed-data.json",
  [string]$Report = ".\import-report.json"
)

Add-Type -AssemblyName System.IO.Compression.FileSystem
$zip = [IO.Compression.ZipFile]::OpenRead((Resolve-Path $Source))
function Read-Zip([string]$Name) {
  $entry = $zip.GetEntry($Name)
  if (-not $entry) { return "" }
  $reader = [IO.StreamReader]::new($entry.Open())
  try { return $reader.ReadToEnd() } finally { $reader.Dispose() }
}

[xml]$stringsXml = Read-Zip "xl/sharedStrings.xml"
$shared = @()
if ($stringsXml.sst) {
  foreach ($item in $stringsXml.sst.si) {
    $shared += (($item.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join "")
  }
}
function Get-CellValue($cell) {
  $inline = $cell.SelectSingleNode('./*[local-name()="is"]')
  if ($inline) { return (($inline.SelectNodes('.//*[local-name()="t"]') | ForEach-Object { $_.InnerText }) -join "") }
  $value = $cell.SelectSingleNode('./*[local-name()="v"]')
  if (-not $value) { return "" }
  if ($cell.t -eq "s") { return $script:shared[[int]$value.InnerText] }
  return $value.InnerText
}
function Normalize-Key([string]$Value) {
  $formD = $Value.Trim().ToLowerInvariant().Normalize([Text.NormalizationForm]::FormD)
  return -join ($formD.ToCharArray() | Where-Object { [Globalization.CharUnicodeInfo]::GetUnicodeCategory($_) -ne [Globalization.UnicodeCategory]::NonSpacingMark })
}
function New-Code([int]$Index, [int]$Length) {
  $value = ""
  for ($i = 0; $i -lt $Length; $i++) {
    $value = [char](65 + ($Index % 26)) + $value
    $Index = [math]::Floor($Index / 26)
  }
  return $value
}

$raw = @()
foreach ($sheetNumber in 2..5) {
  [xml]$sheet = Read-Zip "xl/worksheets/sheet$sheetNumber.xml"
  foreach ($row in $sheet.SelectNodes('//*[local-name()="sheetData"]/*[local-name()="row"]') | Where-Object { [int]$_.r -gt 1 }) {
    $cells = @{}
    foreach ($cell in $row.SelectNodes('./*[local-name()="c"]')) {
      $column = ([regex]::Match($cell.r, '^[A-Z]+')).Value
      $cells[$column] = Get-CellValue $cell
    }
    $client = ([string]$cells.A).Trim()
    $work = ([string]$cells.B).Trim()
    $reference = ([string]$cells.C).Trim().ToUpperInvariant()
    if (-not $client -or -not $work -or -not $reference) { continue }
    $status = if ($sheetNumber -eq 2) { $cells.L } elseif ($sheetNumber -eq 3) { $cells.I } else { $cells.F }
    $details = if ($sheetNumber -eq 2) {
      [ordered]@{ specimenSize=$cells.D; specimenType=$cells.E; contact=$cells.F; address=$cells.G; fixedEmployee=$cells.H; laboratoryType=$cells.I; pressId=$cells.J; observations=$cells.K; originalStatus=$cells.L }
    } elseif ($sheetNumber -eq 3) {
      [ordered]@{ contact=$cells.D; address=$cells.E; fixedEmployee=$cells.F; laboratoryType=$cells.G; observations=$cells.H; originalStatus=$cells.I }
    } else {
      [ordered]@{ fixedEmployee=$cells.D; laboratoryType=$cells.E; originalStatus=$cells.F }
    }
    $raw += [pscustomobject]@{ Sheet=$sheetNumber; Row=[int]$row.r; Client=$client; Work=$work; Reference=$reference; Active=([string]$status -notmatch 'FINAL'); Details=$details }
  }
}
$zip.Dispose()

$used = @{}
$repairs = @()
$nextIndex = 0
function Next-FreeCode {
  while ($true) {
    $length = if ($script:nextIndex -lt 676) { 2 } else { 3 }
    $index = if ($length -eq 2) { $script:nextIndex } else { $script:nextIndex - 676 }
    $script:nextIndex++
    $candidate = New-Code $index $length
    if (-not $script:used.ContainsKey($candidate)) { return $candidate }
  }
}
function Preferred-Code([string]$Original) {
  $letters = ($Original -replace '[^A-Z]', '')
  if ($letters.Length -ge 2 -and $letters.Length -le 3) { return $letters }
  if ($letters.Length -gt 3) { return $letters.Substring(0,2) + $letters.Substring($letters.Length - 1,1) }
  return $null
}

$groups = [ordered]@{}
foreach ($item in $raw) {
  $key = "$(Normalize-Key $item.Client)|$(Normalize-Key $item.Work)"
  if (-not $groups.Contains($key)) {
    $groups[$key] = [ordered]@{ clientName=$item.Client; name=$item.Work; active=$item.Active; sourceRows=@(); originalReferences=@(); details=[ordered]@{} }
  }
  $group = $groups[$key]
  $group.active = $group.active -or $item.Active
  $group.sourceRows += "S$($item.Sheet)R$($item.Row)"
  if ($group.originalReferences -notcontains $item.Reference) { $group.originalReferences += $item.Reference }
  foreach ($detail in $item.Details.GetEnumerator()) {
    $value = ([string]$detail.Value).Trim()
    if (-not $value) { continue }
    if (-not $group.details.Contains($detail.Key)) { $group.details[$detail.Key] = $value }
    elseif (($group.details[$detail.Key] -split ' \| ') -notcontains $value) { $group.details[$detail.Key] += " | $value" }
  }
}

$clients = [ordered]@{}
$clientIds = @{}
$works = [ordered]@{}
$registry = [ordered]@{}
$workNumber = 0
foreach ($group in $groups.Values) {
  $clientKey = Normalize-Key $group.clientName
  if (-not $clientIds.ContainsKey($clientKey)) {
    $clientId = "client_{0:d3}" -f ($clientIds.Count + 1)
    $clientIds[$clientKey] = $clientId
    $clients[$clientId] = [ordered]@{ name=$group.clientName; createdAt=0; updatedAt=0 }
  }
  $workNumber++
  $workId = "work_{0:d3}" -f $workNumber
  $finalRefs = @()
  foreach ($original in $group.originalReferences) {
    $candidate = Preferred-Code $original
    $reason = if ($original -notmatch '^[A-Z]{2,3}$') { "formato inválido" } else { $null }
    if (-not $candidate -or $candidate -notmatch '^[A-Z]{2,3}$') { $candidate = Next-FreeCode }
    elseif ($used.ContainsKey($candidate) -and $used[$candidate] -ne $workId) { $reason = if ($reason) { "$reason e referência duplicada" } else { "referência duplicada" }; $candidate = Next-FreeCode }
    if ($reason) { $repairs += [pscustomobject]@{ original=$original; replacement=$candidate; reason=$reason; client=$group.clientName; work=$group.name } }
    $used[$candidate] = $workId
    if ($finalRefs -notcontains $candidate) { $finalRefs += $candidate }
  }
  $works[$workId] = [ordered]@{ clientId=$clientIds[$clientKey]; clientName=$group.clientName; name=$group.name; references=$finalRefs; active=[bool]$group.active; details=$group.details; createdAt=0; updatedAt=0; sourceRows=$group.sourceRows; originalReferences=$group.originalReferences }
  foreach ($reference in $finalRefs) { $registry[$reference] = [ordered]@{ workId=$workId; status=$(if ($group.active) { "active" } else { "inactive" }); firstUsedAt=0; updatedAt=0 } }
}

$seed = [ordered]@{ clients=$clients; works=$works; referenceRegistry=$registry }
$utf8 = [Text.UTF8Encoding]::new($false)
[IO.File]::WriteAllText((Join-Path (Get-Location) $Output), ($seed | ConvertTo-Json -Depth 8), $utf8)
[IO.File]::WriteAllText((Join-Path (Get-Location) $Report), ([ordered]@{ sourceRows=$raw.Count; clients=$clients.Count; works=$works.Count; references=$registry.Count; activeWorks=($works.Values | Where-Object active).Count; inactiveWorks=($works.Values | Where-Object { -not $_.active }).Count; repairs=$repairs } | ConvertTo-Json -Depth 6), $utf8)
Write-Output "Seed: $($clients.Count) clientes, $($works.Count) obras, $($registry.Count) referências. Ajustes: $($repairs.Count)."
