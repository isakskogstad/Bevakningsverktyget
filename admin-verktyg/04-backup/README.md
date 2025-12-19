# Backup

## Syfte
Säkerhetskopiera viktiga data.

## Vad backas upp
- Köploggar (`data/purchase-logs/`)
- Framgångsrika metoder (`data/successful-methods/`)
- Konfiguration (ej .env)
- Nedladdade dokument (`output/`)

## Backup-plats
`backups/`

## Struktur
```
backups/
├── session-start/
│   └── YYYY-MM-DD_HH-MM-SS/
├── session-end/
│   └── YYYY-MM-DD_HH-MM-SS/
└── changes/
    └── YYYY-MM-DD_HH-MM-SS_before-[action]/
```

## Manuell backup
```bash
# Skapa backup
mkdir -p backups/manual/$(date +%Y-%m-%d_%H-%M-%S)
cp -r data/ backups/manual/$(date +%Y-%m-%d_%H-%M-%S)/
cp -r output/ backups/manual/$(date +%Y-%m-%d_%H-%M-%S)/
```

## Retention
- Behåll minst 7 dagars backups
- Rensa äldre manuellt
