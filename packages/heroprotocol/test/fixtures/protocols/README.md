Two of Blizzard's protocol definition files, verbatim from
https://github.com/Blizzard/heroprotocol (MIT licence, Copyright 2015-2021
Blizzard Entertainment), used to test the Python-to-definition converter:

- `protocol29406.py` — the bootstrap protocol every header is read with
- `protocol85027.py` — the current lineage (builds 85027 through 96477 share it)

They are source code, not game data, and carry no player information.
