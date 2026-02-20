from __future__ import annotations

import math
import os
import re
import threading
from dataclasses import dataclass
from pathlib import Path
from tempfile import gettempdir
from typing import Any, Callable, List, Optional

from app.core.optimization_schemas import OptimizationProgressPoint


class BayesianDependencyError(RuntimeError):
    pass


class TrialPruneSignal(Exception):
    pass


@dataclass
class BayesianTrialOutcome:
    score: float
    combo: Optional[dict] = None
    eval_payload: Optional[dict] = None


@dataclass
class BayesianRunOutput:
    successful_trials: List[BayesianTrialOutcome]
    trials_completed: int
    trials_pruned: int
    best_score_progression: List[OptimizationProgressPoint]
    convergence_curve_data: List[OptimizationProgressPoint]


def _load_optuna():
    try:
        import optuna  # type: ignore
    except ModuleNotFoundError as exc:  # pragma: no cover
        raise BayesianDependencyError(
            "optuna is required for optimization_mode=bayesian. Install backend dependencies to continue."
        ) from exc
    return optuna


def _sanitize_study_key(value: str) -> str:
    return re.sub(r"[^a-zA-Z0-9_.-]+", "-", value).strip("-") or "default-study"


def _build_resume_storage(study_key: str) -> tuple[str, str]:
    safe_key = _sanitize_study_key(study_key)
    db_path = Path(gettempdir()) / f"btc-grid-optuna-{safe_key}.sqlite3"
    return f"sqlite:///{db_path}", safe_key


def run_bayesian_search(
    *,
    total_trials: int,
    max_workers: int,
    warmup_ratio: float,
    random_seed: Optional[int],
    resume_study: bool,
    resume_study_key: Optional[str],
    objective_builder: Callable[[Any], BayesianTrialOutcome],
    progress_hook: Optional[Callable[[int, int], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> BayesianRunOutput:
    return _run_optuna_search(
        total_trials=total_trials,
        max_workers=max_workers,
        warmup_ratio=warmup_ratio,
        random_seed=random_seed,
        resume_study=resume_study,
        resume_study_key=resume_study_key,
        objective_builder=objective_builder,
        progress_hook=progress_hook,
        should_stop=should_stop,
        mode="bayesian",
    )


def run_random_pruned_search(
    *,
    total_trials: int,
    max_workers: int,
    random_seed: Optional[int],
    resume_study: bool,
    resume_study_key: Optional[str],
    objective_builder: Callable[[Any], BayesianTrialOutcome],
    progress_hook: Optional[Callable[[int, int], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
) -> BayesianRunOutput:
    return _run_optuna_search(
        total_trials=total_trials,
        max_workers=max_workers,
        warmup_ratio=0.0,
        random_seed=random_seed,
        resume_study=resume_study,
        resume_study_key=resume_study_key,
        objective_builder=objective_builder,
        progress_hook=progress_hook,
        should_stop=should_stop,
        mode="random_pruned",
    )


def _run_optuna_search(
    *,
    total_trials: int,
    max_workers: int,
    warmup_ratio: float,
    random_seed: Optional[int],
    resume_study: bool,
    resume_study_key: Optional[str],
    objective_builder: Callable[[Any], BayesianTrialOutcome],
    progress_hook: Optional[Callable[[int, int], None]] = None,
    should_stop: Optional[Callable[[], bool]] = None,
    mode: str = "bayesian",
) -> BayesianRunOutput:
    optuna = _load_optuna()
    optuna.logging.set_verbosity(optuna.logging.WARNING)

    trial_budget = max(1, int(total_trials))
    warmup_trials = int(trial_budget * max(0.0, min(warmup_ratio, 0.9)))
    startup_trials = max(0, min(warmup_trials, trial_budget))

    effective_workers = max(1, min(int(max_workers), os.cpu_count() or 1))

    if mode == "bayesian":
        sampler = optuna.samplers.TPESampler(
            seed=random_seed,
            n_startup_trials=startup_trials,
            multivariate=False,
            group=False,
            constant_liar=False,
        )
    elif mode == "random_pruned":
        sampler = optuna.samplers.RandomSampler(seed=random_seed)
    else:  # pragma: no cover
        raise ValueError(f"unsupported optuna search mode: {mode}")

    if resume_study:
        storage_key = resume_study_key or ("btc-grid-default" if mode == "bayesian" else "btc-grid-random-pruned")
        storage_url, study_name = _build_resume_storage(storage_key)
        study = optuna.create_study(
            direction="maximize",
            sampler=sampler,
            storage=storage_url,
            study_name=study_name,
            load_if_exists=True,
        )
    else:
        study = optuna.create_study(direction="maximize", sampler=sampler)

    lock = threading.Lock()
    successful_trials: List[BayesianTrialOutcome] = []
    trials_done = 0
    trials_completed = 0
    trials_pruned = 0
    running_best = float("-inf")
    best_score_progression: List[OptimizationProgressPoint] = []
    convergence_curve_data: List[OptimizationProgressPoint] = []

    def _advance_done() -> None:
        if progress_hook:
            progress_hook(trials_done, trial_budget)

    def objective(trial: Any) -> float:
        nonlocal trials_done, trials_completed, trials_pruned, running_best
        if should_stop and should_stop():
            study.stop()
            raise optuna.TrialPruned("cancelled")
        try:
            outcome = objective_builder(trial)
        except TrialPruneSignal as exc:
            with lock:
                trials_pruned += 1
                trials_done += 1
                _advance_done()
            raise optuna.TrialPruned(str(exc))
        except optuna.TrialPruned:
            with lock:
                trials_pruned += 1
                trials_done += 1
                _advance_done()
            raise

        score = float(outcome.score)
        if not math.isfinite(score):
            score = float("-inf")

        with lock:
            successful_trials.append(outcome)
            trials_completed += 1
            trials_done += 1

            if score > running_best:
                running_best = score

            best_score_progression.append(
                OptimizationProgressPoint(step=trials_done, value=float(running_best))
            )
            convergence_curve_data.append(
                OptimizationProgressPoint(step=trials_done, value=float(score))
            )
            _advance_done()

        return score

    study.optimize(
        objective,
        n_trials=trial_budget,
        n_jobs=effective_workers,
        show_progress_bar=False,
        gc_after_trial=False,
    )

    return BayesianRunOutput(
        successful_trials=successful_trials,
        trials_completed=trials_completed,
        trials_pruned=trials_pruned,
        best_score_progression=best_score_progression,
        convergence_curve_data=convergence_curve_data,
    )
