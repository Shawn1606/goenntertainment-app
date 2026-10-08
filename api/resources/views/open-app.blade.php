<!doctype html>
<html lang="de">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>{{ $title }} · GÖ4Fun</title>
    <style>
        :root { color-scheme: light dark; --ink: #0a0a0a; --muted: #6b6b6b; --bg: #ffffff; --line: #e4e4e4; --accent: #e8174a; }
        @media (prefers-color-scheme: dark) { :root { --ink: #f5f5f5; --muted: #a8a8a8; --bg: #000; --line: #2a2a2a; --accent: #ff3b64; } }
        * { box-sizing: border-box; }
        body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: var(--bg); color: var(--ink);
               font: 16px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif; padding: 24px 16px; }
        main { max-width: 420px; width: 100%; text-align: center; border: 2px solid var(--line); border-radius: 20px; padding: 32px 24px; }
        .logo { font: 700 34px/1 system-ui; background: linear-gradient(135deg, #fe2c55, #dd2a7b, #8134af);
                -webkit-background-clip: text; background-clip: text; color: transparent; margin-bottom: 20px; }
        h1 { font-size: 22px; margin: 0 0 8px; }
        p { color: var(--muted); margin: 0 0 24px; }
        a.btn { display: block; padding: 14px 20px; border-radius: 12px; background: var(--accent); color: #fff; font-weight: 700;
                text-decoration: none; }
        small { display: block; margin-top: 16px; color: var(--muted); }
    </style>
</head>
<body>
<main>
    <div class="logo">GÖ4Fun</div>
    <h1>{{ $title }}</h1>
    <p>{{ $line }}</p>
    <a class="btn" href="{{ $deepLink }}">In der App öffnen</a>
    <small>Noch keine App? Bald im App Store und bei Google Play.</small>
</main>
</body>
</html>
