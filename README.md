🧪 BioSim Lab: Virtual Biochemistry & Protein Analysis SuiteBioSim Lab is an interactive, open-source computational tool suite designed for simulating, analyzing, and quantifying biomolecules in virtual lab environments. It provides algorithms and interactive tools for protein quantification (Lowry, Bradford, Biuret assays), N-terminal sequencing (Sanger's & Dansyl Methods), enzyme kinetics modeling, and molecular simulation.🚀 Key FeaturesProtein Quantification Engine:Lowry Method: Standard curve calculation, Folin-Ciocalteu absorbance modeling at $660\text{ nm}$.Bradford Assay: Coomassie Brilliant Blue G-250 binding simulations at $595\text{ nm}$.Biuret Assay: Peptide bond complexation modeling.N-Terminal Peptide Sequencing & Cleavage:Sanger's Reagent (FDNB): DNP-amino acid derivative prediction & chromatographic spot visualization.Dansyl Chloride Marking: Fluorescence emission modeling under UV excitation ($330\text{--}360\text{ nm}$).Multi-Chain Polypeptide Resolution: Quantitative molar ratio analysis to determine the exact number of sub-units/chains.Spectrophotometric Utilities:Automated Beer-Lambert law calculations ($A = \varepsilon \cdot c \cdot l$).Dynamic standard curve plotting with linear regression & $R^2$ accuracy scoring.🛠️ Architecture & Tech StackLanguage: Python 3.10+Data Processing: numpy, pandas, scipyPlotting & Visualization: matplotlib, seabornInteractive CLI / Web Interface: streamlit / richTesting Suite: pytest📦 Installation & SetupPrerequisitesMake sure you have Python 3.10+ and pip installed.git clone https://github.com/your-username/biosim-lab.git
cd biosim-lab
Create a Virtual Environment# On macOS/Linux
python3 -m venv venv
source venv/bin/activate

# On Windows
python -m venv venv
venv\Scripts\activate
Install Dependenciespip install -r requirements.txt
🧪 Usage Examples1. Protein Concentration Calculation (Lowry Method)from biosim.assays import LowryAssay

# Initialize assay with standard curve concentrations (mg/mL) & absorbances
assay = LowryAssay(
    standards_conc=[0.0, 0.2, 0.4, 0.6, 0.8, 1.0],
    absorbance_660nm=[0.02, 0.18, 0.35, 0.52, 0.69, 0.87]
)



