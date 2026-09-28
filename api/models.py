"""Typed request / response models for the USHNA edge API."""

from typing import Optional

from pydantic import BaseModel, Field


class Health(BaseModel):
    status: str
    version: str


class Well(BaseModel):
    id: str
    cycle: int
    day: int = Field(description='Default production day shown for this well')
    kh: float = Field(description='EnKF permeability-thickness multiplier')
    skin: float
    heatLoss: float = Field(description='EnKF heat-loss coefficient multiplier')
    steam: float = Field(description='Steam injected this cycle, t')
    soak: int = Field(description='Soak time, days')
    spm: float = Field(description='Current strokes per minute')


class Setpoint(BaseModel):
    spm: float = Field(gt=0, le=15, description='Strokes per minute')
    down: float = Field(1.0, gt=0.5, le=1.0, description='Downstroke speed factor (1 = symmetric)')


class State(BaseModel):
    well_id: str
    day: int
    setpoint: Setpoint
    T_bar: float = Field(description='Heated-zone average temperature, °C (Boberg–Lantz)')
    T_pump: float = Field(description='Fluid temperature at the pump, °C')
    mu: float = Field(description='Viscosity at the pump, cP (Walther)')
    fmi: float = Field(description='Minimum Float Margin Index along the rod string')
    fmi_depth: float = Field(description='Depth of the minimum FMI, m')
    gross: float = Field(description='Gross fluid rate, bbl/d')
    fillage: float
    cut_day: int = Field(description='Optimal-stopping re-injection day')
    cut_band: int
    sor: float = Field(description='Cumulative steam-oil ratio to date')
    npv: float = Field(description='Cycle NPV at the cut-off day, ₹')


class Recommendation(BaseModel):
    well_id: str
    day: int
    current: Setpoint
    setpoint: Setpoint = Field(description='Optimizer setpoint after the safety envelope')
    infeasible: bool = Field(description='True if no grid point met every constraint')
    binding: Optional[str] = Field(description='Envelope constraint that clamped the optimizer, if any')
    fmi_now: float
    fmi_after: float
    gross_now: float
    gross_after: float
    why: str
    driver: str
    relation: str = Field(description='Governing relation, TeX')
    effect: str
    confidence: str
    cycle: str


class SubmitResult(BaseModel):
    well_id: str
    day: int
    requested: Setpoint
    applied: Setpoint
    binding: Optional[str] = Field(description='Constraint that clamped the request, e.g. "FMI(z) > 0.15"')
    accepted: bool = Field(description='False when the envelope changed the request')


class TraceRow(BaseModel):
    quantity: str
    value: float
    unit: str
    equation: str
    code: str
