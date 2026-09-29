import os
import pandas as pd
import numpy as np

# Output directory
OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "historical_test")
os.makedirs(OUT_DIR, exist_ok=True)

# The 6 modelled wells in USHNA
WELLS = [
    {"id": "BGW-07", "cycle": 4, "kh": 1.0, "skin": 3.4},
    {"id": "BGW-04", "cycle": 6, "kh": 1.15, "skin": 2.1},
    {"id": "BGW-11", "cycle": 3, "kh": 0.85, "skin": 4.2},
    {"id": "BGW-02", "cycle": 5, "kh": 1.05, "skin": 2.8},
    {"id": "BGW-15", "cycle": 2, "kh": 0.95, "skin": 3.0},
    {"id": "BGW-09", "cycle": 4, "kh": 1.1, "skin": 2.5},
]

def generate_clean_sample():
    """Generates a perfectly clean historical dataset."""
    rows = []
    for w in WELLS:
        for c in range(1, w["cycle"]):
            steam = w.get("steam", 2600) - 150 + 50 * c + [0, 40, -30, 20, -10][c % 5]
            sor = 7 + 0.45 * c + 0.3 * np.sin(c * 1.7 + w["kh"] * 5) + (w["skin"] - 3) * 0.4
            oil = round((steam * 6.29) / sor)
            energy = round(20 + 0.6 * c + np.cos(c + w["skin"]), 1)
            failures = [1, 2, 0, 3, 1][int((c + round(w["skin"])) % 5)]
            rows.append({
                "Well ID": w["id"],
                "Cycle No.": c,
                "Steam injected (t)": steam,
                "Oil produced (bbl)": oil,
                "Energy (kWh/bbl)": energy,
                "Rod failures": failures
            })
    
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT_DIR, "clean_historical_cycles.csv"), index=False)
    df.to_excel(os.path.join(OUT_DIR, "clean_historical_cycles.xlsx"), index=False, engine='openpyxl')
    print("Generated clean_historical_cycles.csv and .xlsx")

def generate_messy_sample():
    """Generates a messy dataset to test Edge Telemetry parsing logic."""
    rows = []
    
    # 1. Valid row with alternate headers
    rows.append({
        "well": "BGW-07",
        "css cycle": 1,
        "steam tonnes": 2500,
        "cum oil": 2100,
        "energy per bbl": 22.5,
        "rod breaks": 1
    })
    
    # 2. Row with missing optional fields
    rows.append({
        "well": "BGW-07",
        "css cycle": 2,
        "steam tonnes": 2600,
        "cum oil": 2150,
        "energy per bbl": None,
        "rod breaks": None
    })
    
    # 3. Bad row: negative steam (should skip)
    rows.append({
        "well": "BGW-07",
        "css cycle": 3,
        "steam tonnes": -500,
        "cum oil": 2200,
        "energy per bbl": 23.0,
        "rod breaks": 0
    })
    
    # 4. Bad row: oil <= 0 (should skip)
    rows.append({
        "well": "BGW-04",
        "css cycle": 1,
        "steam tonnes": 2800,
        "cum oil": 0,
        "energy per bbl": 25.0,
        "rod breaks": 2
    })
    
    # 5. Bad row: unknown well (should skip)
    rows.append({
        "well": "BGW-99",
        "css cycle": 1,
        "steam tonnes": 2500,
        "cum oil": 2000,
        "energy per bbl": 21.0,
        "rod breaks": 0
    })
    
    # 6. Duplicate row
    rows.append({
        "well": "BGW-04",
        "css cycle": 2,
        "steam tonnes": 2900,
        "cum oil": 2300,
        "energy per bbl": 22.0,
        "rod breaks": 1
    })
    rows.append({
        "well": "BGW-04",
        "css cycle": 2,
        "steam tonnes": 2950,
        "cum oil": 2350,
        "energy per bbl": 22.5,
        "rod breaks": 1
    })

    # Add remaining valid rows
    for w in WELLS:
        for c in range(1, w["cycle"]):
            if w["id"] == "BGW-07" and c in [1, 2, 3]: continue
            if w["id"] == "BGW-04" and c in [1, 2]: continue
            
            steam = w.get("steam", 2600) - 150 + 50 * c + [0, 40, -30, 20, -10][c % 5]
            sor = 7 + 0.45 * c + 0.3 * np.sin(c * 1.7 + w["kh"] * 5) + (w["skin"] - 3) * 0.4
            oil = round((steam * 6.29) / sor)
            rows.append({
                "well": w["id"],
                "css cycle": c,
                "steam tonnes": steam,
                "cum oil": oil,
                "energy per bbl": round(20 + 0.6 * c + np.cos(c + w["skin"]), 1),
                "rod breaks": [1, 2, 0, 3, 1][int((c + round(w["skin"])) % 5)]
            })
            
    df = pd.DataFrame(rows)
    df.to_csv(os.path.join(OUT_DIR, "messy_historical_cycles.csv"), index=False)
    
    # For Excel, add a blank title row to test title skipping logic
    # We can just write a dummy title row using openpyxl directly, 
    # but simplest is just to use to_excel and leave as is for now. 
    # To test the title skipping, we can do this:
    with pd.ExcelWriter(os.path.join(OUT_DIR, "messy_historical_cycles.xlsx"), engine='openpyxl') as writer:
        # Start at row 2 so rows 0 and 1 are empty, which tests the parser's logic to find headers
        df.to_excel(writer, index=False, sheet_name='Cycles', startrow=2)
    
    print("Generated messy_historical_cycles.csv and .xlsx")

if __name__ == "__main__":
    generate_clean_sample()
    generate_messy_sample()
