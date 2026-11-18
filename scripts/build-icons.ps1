# 画 PWA 安装图标（与 public/favicon.svg 同一个图形）。
# 用法：pwsh -File scripts/build-icons.ps1（要用 PowerShell 7；5.1 会按 GBK 读这个 UTF-8 文件）
Add-Type -AssemblyName System.Drawing
$outDir = Join-Path $PSScriptRoot "..\public\icons"
New-Item -ItemType Directory -Force $outDir | Out-Null

foreach ($size in 192, 512) {
  $bmp = New-Object System.Drawing.Bitmap $size, $size
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.SmoothingMode = [System.Drawing.Drawing2D.SmoothingMode]::AntiAlias
  $g.Clear([System.Drawing.Color]::Transparent)
  $k = $size / 32.0

  # 满版底色（maskable 图标需要铺满），圆角交给系统裁切
  $bg = [System.Drawing.SolidBrush]::new([System.Drawing.Color]::FromArgb(21, 89, 196)) # Grasso blue #1559c4
  $g.FillRectangle($bg, 0, 0, $size, $size)

  # 图形缩到 80%，留出 maskable 安全区
  $s = 0.8
  $o = $size * (1 - $s) / 2
  $pen = [System.Drawing.Pen]::new([System.Drawing.Color]::White, [float](2.6 * $k * $s))
  $pen.StartCap = [System.Drawing.Drawing2D.LineCap]::Round
  $pen.EndCap = [System.Drawing.Drawing2D.LineCap]::Round
  function P([double]$x, [double]$y) { [System.Drawing.PointF]::new([float]($o + $x * $k * $s), [float]($o + $y * $k * $s)) }
  # M8 22.5 c4.5 0 6-9 10.5-9 c2.6 0 3.4 2.6 5.5 2.6
  $g.DrawBezier($pen, (P 8 22.5), (P 12.5 22.5), (P 14 13.5), (P 18.5 13.5))
  $g.DrawBezier($pen, (P 18.5 13.5), (P 21.1 13.5), (P 21.9 16.1), (P 24 16.1))
  $r = 2.2 * $k * $s
  $c = P 24 10
  $g.FillEllipse([System.Drawing.Brushes]::White, $c.X - $r, $c.Y - $r, 2 * $r, 2 * $r)

  $bmp.Save((Join-Path $outDir "icon-$size.png"), [System.Drawing.Imaging.ImageFormat]::Png)
  $g.Dispose(); $bmp.Dispose()
}
Write-Output "icons written to $outDir"
