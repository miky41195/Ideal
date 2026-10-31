<#
.SYNOPSIS
  Measures Ideal's RAM including all descendant processes (msedgewebview2, PTY children).
  Budget metric: PRIVATE working set (gross working set is printed for info only).
  Exit code 1 if private total >= 250 MB or the Ideal main process private >= 50 MB.
#>
param([string]$ProcessName = 'ideal')

$TotalBudgetMB = 250
$MainBudgetMB = 50
$Excluded = @('claude*', 'pwsh*', 'powershell*', 'cmd*', 'conhost*', 'OpenConsole*')

$all = Get-CimInstance Win32_Process
$perf = @{}
Get-CimInstance Win32_PerfFormattedData_PerfProc_Process | ForEach-Object { $perf[[uint32]$_.IDProcess] = $_ }
$byParent = $all | Group-Object ParentProcessId -AsHashTable -AsString
$mains = @($all | Where-Object { $_.Name -like "$ProcessName.exe" })
if ($mains.Count -eq 0) {
  Write-Host "Processo '$ProcessName' non trovato."
  exit 2
}

function Test-Excluded($name) {
  foreach ($p in $Excluded) { if ($name -like "$p.exe" -or $name -like $p) { return $true } }
  return $false
}

# Walk descendants; an excluded process is skipped together with its whole subtree
# (e.g. node.exe spawned by claude).
$rows = New-Object System.Collections.Generic.List[object]
$seen = New-Object System.Collections.Generic.HashSet[uint32]
function Walk($proc, $isMain) {
  if (-not $seen.Add([uint32]$proc.ProcessId)) { return }
  $gross = [math]::Round(([double]$proc.WorkingSetSize) / 1MB, 1)
  $p = $perf[[uint32]$proc.ProcessId]
  $priv = if ($p) { [math]::Round(([double]$p.WorkingSetPrivate) / 1MB, 1) } else { 0 }
  $rows.Add([pscustomobject]@{ PID = $proc.ProcessId; Name = $proc.Name; PrivateMB = $priv; GrossMB = $gross; Main = $isMain })
  foreach ($c in @($byParent["$($proc.ProcessId)"])) {
    if ($null -eq $c) { continue }
    if (Test-Excluded $c.Name) { continue }
    # PID reuse guard: a real child cannot predate its parent.
    if ($c.CreationDate -lt $proc.CreationDate) { continue }
    Walk $c $false
  }
}
foreach ($m in $mains) { Walk $m $true }

$rows | Sort-Object PrivateMB -Descending | Format-Table PID, Name, PrivateMB, GrossMB -AutoSize

$total = [math]::Round(($rows | Measure-Object PrivateMB -Sum).Sum, 1)
$totalGross = [math]::Round(($rows | Measure-Object GrossMB -Sum).Sum, 1)
$main = [math]::Round(($rows | Where-Object Main | Measure-Object PrivateMB -Sum).Sum, 1)
$web = [math]::Round([double](($rows | Where-Object { $_.Name -like 'msedgewebview2*' } | Measure-Object PrivateMB -Sum).Sum), 1)

Write-Host "Totale privato:  $total MB (budget < $TotalBudgetMB)  [lordo: $totalGross MB, info]"
Write-Host "Ideal main:      $main MB privati (budget < $MainBudgetMB)"
Write-Host "msedgewebview2:  $web MB privati"

if ($total -ge $TotalBudgetMB -or $main -ge $MainBudgetMB) {
  Write-Host 'FUORI BUDGET'
  exit 1
}
Write-Host 'OK'
exit 0
