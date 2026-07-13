# Converts an Obsidian Overwatch-tracking vault into a Vantage import file (JSON).
#
# Prerequisites:
#   - Windows PowerShell 5.1 (no external modules required — YAML frontmatter is hand-parsed).
#   - A vault folder containing a `match/` subfolder of `*.md` files with `---` YAML frontmatter.
#
# Usage:
#   .\import-obsidian.ps1 -VaultPath "C:\path\to\vault"
#   .\import-obsidian.ps1 -VaultPath "C:\path\to\vault" -OutFile "vantage-import.json" -Account "Lampenlicht"
#   .\import-obsidian.ps1 -VaultPath "C:\path\to\vault" -CurrentRank "Diamond 3 45%"

param(
    [string]$VaultPath,
    [string]$OutFile = "vantage-import.json",
    [string]$Account = "Lampenlicht",
    [string]$CurrentRank
)

# --- Input validation -------------------------------------------------------

if (-not $VaultPath) {
    Write-Error "No vault path given. Pass -VaultPath <path to the Obsidian vault root>."
    exit 1
}

if (-not (Test-Path -LiteralPath $VaultPath -PathType Container)) {
    Write-Error "Vault path not found or not a directory: $VaultPath"
    exit 1
}

$matchDir = Join-Path $VaultPath "match"
if (-not (Test-Path -LiteralPath $matchDir -PathType Container)) {
    Write-Error "No 'match' subfolder found under vault: $matchDir"
    exit 1
}

# --- Rank anchor (optional) -------------------------------------------------

$anchor = $null
if ($CurrentRank) {
    $tiers = [ordered]@{
        bronze      = "Bronze"
        silver      = "Silver"
        gold        = "Gold"
        platinum    = "Platinum"
        diamond     = "Diamond"
        master      = "Master"
        grandmaster = "Grandmaster"
        champion    = "Champion"
    }

    $parts = $CurrentRank.Trim() -split "\s+"
    if ($parts.Count -lt 2 -or $parts.Count -gt 3) {
        Write-Error "Invalid -CurrentRank '$CurrentRank'. Expected 'Tier Division [Pct%]', e.g. 'Diamond 3' or 'Diamond 3 45%'."
        exit 1
    }

    $tierKey = $parts[0].ToLowerInvariant()
    if (-not $tiers.Contains($tierKey)) {
        Write-Error "Invalid rank tier '$($parts[0])'. Expected one of: $($tiers.Values -join ', ')."
        exit 1
    }
    $anchorTier = $tiers[$tierKey]

    $anchorDivision = 0
    if (-not [int]::TryParse($parts[1], [ref]$anchorDivision) -or $anchorDivision -lt 1 -or $anchorDivision -gt 5) {
        Write-Error "Invalid rank division '$($parts[1])'. Expected an integer 1..5."
        exit 1
    }

    $anchorPct = 0
    if ($parts.Count -eq 3) {
        $pctText = $parts[2].TrimEnd("%")
        if (-not [int]::TryParse($pctText, [ref]$anchorPct) -or $anchorPct -lt 0 -or $anchorPct -gt 100) {
            Write-Error "Invalid rank progress '$($parts[2])'. Expected an integer 0..100 (optional trailing '%')."
            exit 1
        }
    }

    $anchor = [ordered]@{
        role        = "tank"
        tier        = $anchorTier
        division    = $anchorDivision
        progressPct = $anchorPct
    }
}

# --- Map canonicalization ---------------------------------------------------

# Accented names are built from code points so the catalog is byte-identical
# regardless of how this .ps1 is saved (PS 5.1 reads a BOM-less script as ANSI).
$mapEsperanca = "Esperan" + [char]0x00E7 + "a"    # Esperança
$mapParaiso = "Para" + [char]0x00ED + "so"        # Paraíso

$mapCatalog = @(
    "New Queen Street", "Colosseo", $mapEsperanca, "Runasapi", "Redwood Dam",
    "King's Row", "Midtown", "Eichenwalde", "Hollywood", "Numbani",
    "Blizzard World", $mapParaiso, "Neon Junction", "Circuit Royal", "Dorado",
    "Havana", "Junkertown", "Rialto", "Route 66", "Shambali Monastery",
    "Watchpoint: Gibraltar", "Antarctic Peninsula", "Busan", "Ilios",
    "Lijiang Tower", "Nepal", "Oasis", "Samoa", "New Junk City", "Suravasa",
    "Aatlis", "Hanaoka", "Throne of Anubis"
)

# Normalize a map name for case-insensitive matching: lowercase, drop the
# characters ' ’ ` . : _ - and collapse whitespace.
function Get-NormalizedMap {
    param([string]$Name)
    $s = $Name.ToLowerInvariant()
    foreach ($ch in @([char]0x27, [char]0x2019, [char]0x60, ".", ":", "_", "-")) {
        $s = $s.Replace([string]$ch, "")
    }
    $s = ($s -replace "\s+", " ").Trim()
    return $s
}

$mapLookup = @{}
foreach ($m in $mapCatalog) {
    $mapLookup[(Get-NormalizedMap $m)] = $m
}
# Explicit alias: reconcile the old 'k' spelling in source files to Vantage's "Neon Junction".
$mapLookup[(Get-NormalizedMap "Neon Junktion")] = "Neon Junction"

# --- Frontmatter parsing ----------------------------------------------------

# Hand-parse the `---`-fenced YAML frontmatter into a hashtable of key -> raw
# value strings. Returns $null when there is no frontmatter block.
function Get-Frontmatter {
    param([string[]]$Lines)
    if (-not $Lines -or $Lines.Count -eq 0) { return $null }
    if ($Lines[0].Trim() -ne "---") { return $null }
    $fm = @{}
    $i = 1
    while ($i -lt $Lines.Count -and $Lines[$i].Trim() -ne "---") {
        $line = $Lines[$i]
        $idx = $line.IndexOf(":")
        if ($idx -gt 0) {
            $key = $line.Substring(0, $idx).Trim()
            $val = $line.Substring($idx + 1).Trim()
            $fm[$key] = $val
        }
        $i++
    }
    return $fm
}

# --- Convert matches --------------------------------------------------------

$games = New-Object System.Collections.Generic.List[object]
$skipped = New-Object System.Collections.Generic.List[string]
$unmatched = New-Object System.Collections.Generic.List[string]

$files = Get-ChildItem -LiteralPath $matchDir -Filter "*.md" -File | Sort-Object Name

foreach ($file in $files) {
    $raw = [System.IO.File]::ReadAllText($file.FullName, [System.Text.Encoding]::UTF8)
    $lines = $raw -split "`r?`n"
    $fm = Get-Frontmatter $lines

    # Skip empty / frontmatter-less files and any without a result.
    if ($null -eq $fm -or -not $fm.ContainsKey("date") -or
        -not $fm.ContainsKey("result") -or [string]::IsNullOrWhiteSpace($fm["result"])) {
        $skipped.Add($file.Name) | Out-Null
        continue
    }

    # matchId — deterministic: filename without .md, lowercased.
    $baseName = [System.IO.Path]::GetFileNameWithoutExtension($file.Name)
    $matchId = "manual-import-" + $baseName.ToLowerInvariant()

    # timestamp — local date + time -> epoch milliseconds.
    $date = $fm["date"].Trim()
    $time = "00:00"
    if ($fm.ContainsKey("time") -and -not [string]::IsNullOrWhiteSpace($fm["time"])) {
        $time = $fm["time"].Trim()
    }
    # ParseExact throws on any off-format date/time (e.g. "9:30", "2024-3-5").
    # Under `powershell -File` that throw is NON-terminating, so without a catch
    # the loop would continue with the PREVIOUS file's $dt and silently mis-date
    # this match — skip it instead. InvariantCulture keeps parsing Gregorian and
    # locale-independent (a non-Gregorian default calendar would mis-read the year).
    try {
        $dt = [DateTime]::ParseExact("$date $time", "yyyy-MM-dd HH:mm",
            [System.Globalization.CultureInfo]::InvariantCulture)
    }
    catch {
        $skipped.Add($file.Name) | Out-Null
        continue
    }
    $ts = [DateTimeOffset]::new($dt).ToUnixTimeMilliseconds()

    # map — canonicalize to the Vantage catalog spelling.
    $srcMap = $fm["map"].Trim()
    $norm = Get-NormalizedMap $srcMap
    if ($mapLookup.ContainsKey($norm)) {
        $map = $mapLookup[$norm]
    }
    else {
        $map = $srcMap
        if (-not $unmatched.Contains($srcMap)) {
            $unmatched.Add($srcMap) | Out-Null
        }
    }

    # heroes — parse the `[A, B]` list; empty -> [].
    $heroes = @()
    if ($fm.ContainsKey("heroes") -and -not [string]::IsNullOrWhiteSpace($fm["heroes"])) {
        $inner = $fm["heroes"].Trim().TrimStart("[").TrimEnd("]").Trim()
        if ($inner -ne "") {
            $heroes = @($inner -split "," | ForEach-Object { $_.Trim() } | Where-Object { $_ -ne "" })
        }
    }

    $game = [ordered]@{
        matchId   = $matchId
        timestamp = $ts
        account   = $Account
        role      = "tank"
        map       = $map
        result    = $fm["result"].Trim()
        gameType  = "Competitive"
        source    = "manual"
        heroes    = $heroes
    }

    # srDelta — keep 0; omit when the line is absent/blank.
    if ($fm.ContainsKey("sr_change") -and -not [string]::IsNullOrWhiteSpace($fm["sr_change"])) {
        $srDelta = 0
        if ([int]::TryParse($fm["sr_change"].Trim(), [ref]$srDelta)) {
            $game["srDelta"] = $srDelta
        }
    }

    # performance — stars 1..5 -> 0/25/50/75/100; omit when absent.
    if ($fm.ContainsKey("performance") -and -not [string]::IsNullOrWhiteSpace($fm["performance"])) {
        $stars = 0
        if ([int]::TryParse($fm["performance"].Trim(), [ref]$stars) -and $stars -ge 1 -and $stars -le 5) {
            $game["performance"] = ($stars - 1) * 25
        }
    }

    $games.Add($game) | Out-Null
}

# --- Build envelope & write -------------------------------------------------

$envelope = [ordered]@{
    vantageImport = 1
    account       = $Account
}
if ($anchor) {
    $envelope.Add("anchor", $anchor)
}
$envelope.Add("games", $games.ToArray())

$outPath = $OutFile
if (-not [System.IO.Path]::IsPathRooted($outPath)) {
    $outPath = Join-Path (Get-Location).Path $outPath
}

$json = $envelope | ConvertTo-Json -Depth 12
$utf8NoBom = New-Object System.Text.UTF8Encoding($false)
[System.IO.File]::WriteAllText($outPath, $json, $utf8NoBom)

# --- Summary ----------------------------------------------------------------

Write-Host "Wrote $($games.Count) games to $outPath"
Write-Host "Skipped $($skipped.Count) file(s)."
foreach ($name in $skipped) {
    Write-Host "  - $name"
}
if ($unmatched.Count -gt 0) {
    Write-Host "Unmatched maps (kept verbatim):"
    foreach ($name in $unmatched) {
        Write-Host "  - $name"
    }
}
else {
    Write-Host "Unmatched maps: none."
}
