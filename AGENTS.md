# AGENTS.md

Guia ràpida per a agents d'IA en aquest repositori.

## CodeGraph (Estalvi de Tokens)

Utilitza **CodeGraph** abans de fer lectures extenses o grep per estalviar context i tokens:

1. **Inicialitzar**: Si no existeix el directori `.codegraph/`:
   ```bash
   codegraph init
   ```
2. **Sincronitzar**: Si `.codegraph/` ja existeix però s'han modificat o creat fitxers:
   ```bash
   codegraph sync
   ```
3. **Ús del MCP**:
   - Utilitza l'eina MCP `codegraph_explore` per cercar fitxers, definicions de símbols, classes o funcions abans de llegir fitxers complets.

## Tests i Verificació

- **Tests unitaris**: `.venv/bin/pytest`
- **Sintaxi frontend**: `node -c custom_components/shelly_schedules/frontend/shelly-schedules-card.js`
