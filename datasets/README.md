# USHNA Datasets

External reservoir engineering datasets scraped/compiled from published literature,
formatted for direct use with the USHNA digital twin and ML pipeline.

## Data Sources

### 1. SPE Middle East Oil & Gas Show 2019 — Oman Heavy Oil Thermal Recovery
- **Source**: SPE MEOS 2019 conference papers (SPE-195157, SPE-195529, SPE-195355)
- **Fields**: Mukhaizna, Marmul, Gharif Formation (Oman)
- **Content**: Reservoir properties, steam injection parameters, thermal EOR design data
- **Files**:
  - `spe_meos2019_oman_heavy_oil_reservoir_properties.xlsx`
  - `spe_meos2019_oman_heavy_oil_reservoir_properties.csv`

### 2. Open Porous Media (OPM) — Black Oil Model Benchmark Datasets
- **Source**: [OPM/opm-data](https://github.com/OPM/opm-data) (Open Database License)
- **Benchmark**: SPE1 Comparative Solution Project (Odeh, 1981)
- **Content**: PVT properties (oil/gas/water), relative permeability (SWOF/SGOF),
  grid properties, well specifications
- **Files**:
  - `opm_spe1_pvt_water.xlsx` / `.csv`
  - `opm_spe1_pvt_oil_gas.xlsx` / `.csv`
  - `opm_spe1_relative_permeability.xlsx` / `.csv`
  - `opm_spe1_grid_properties.xlsx` / `.csv`

### 3. CSS Field Data — James J. Sheng (2013)
- **Source**: *Enhanced Oil Recovery Field Case Studies*, Ch. 16: Cyclic Steam Stimulation
  (Gulf Professional Publishing / Elsevier, 2013; ResearchGate)
- **Fields**: Cold Lake (Canada), Midway Sunset (USA), Liaohe Du-66 (China),
  Karamay (China), Gudao (China)
- **Content**: CSS screening criteria, cycle parameters, field reservoir properties,
  production performance data
- **Files**:
  - `sheng2013_css_screening_criteria.xlsx` / `.csv`
  - `sheng2013_css_field_case_data.xlsx` / `.csv`
  - `sheng2013_css_cycle_performance.xlsx` / `.csv`

## Usage with USHNA

These datasets can be loaded directly in Python:

```python
import pandas as pd

# Load SPE MEOS 2019 Oman data
oman = pd.read_csv('datasets/spe_meos2019_oman_heavy_oil_reservoir_properties.csv')

# Load OPM SPE1 PVT
pvt = pd.read_excel('datasets/opm_spe1_pvt_oil_gas.xlsx')

# Load Sheng CSS field data
css = pd.read_excel('datasets/sheng2013_css_field_case_data.xlsx')
```

## Data Integrity

All numerical values are taken directly from published tables, papers, and open-source
datasets. Where exact values were not available from restricted papers, representative
values from the published literature are used with appropriate citations in the
`source` or `reference` column.

## License

- OPM data: [Open Database License (ODbL)](http://opendatacommons.org/licenses/odbl/1.0/)
- SPE paper data: Fair use for research/academic purposes
- Sheng (2013) data: Compiled from published book tables, fair use for research
