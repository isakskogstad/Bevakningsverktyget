# Bolagsbevakning

## Syfte
Bevaka ändringar i svenska företag - styrelseändringar, nyemissioner, konkurser, etc.

## Huvudfil
`src/services/bevakning_service.py`

## Funktioner
- Automatisk bevakning av 1214 företag
- Push-notiser vid ändringar
- Integration med POIT för kungörelser

## Datakällor
- POIT (Post- och Inrikes Tidningar)
- Bolagsverket
- Supabase (loop_table)

## Användning
```python
from src.services.bevakning_service import BevakningService

service = BevakningService()
changes = await service.check_all_companies()
```
