"""Shared aggregation helpers for stats endpoints."""

from __future__ import annotations


MATCH = "$match"
GROUP = "$group"
COND = "$cond"
IF_NULL = "$ifNull"
SPLIT = "$split"
ARRAY_ELEM_AT = "$arrayElemAt"
TO_INT = "$toInt"
MULTIPLY = "$multiply"


def build_time_expr(
    start_field: str = "$start_time",
    end_field: str = "$end_time",
) -> dict:
    """Build a Mongo expression that returns class minutes or 0 for invalid times."""
    return {
        COND: [
            {
                "$and": [
                    {"$regexMatch": {"input": {IF_NULL: [start_field, ""]}, "regex": r"^\d{2}:\d{2}$"}},
                    {"$regexMatch": {"input": {IF_NULL: [end_field, ""]}, "regex": r"^\d{2}:\d{2}$"}},
                ],
            },
            {
                "$subtract": [
                    {
                        "$add": [
                            {MULTIPLY: [{TO_INT: {ARRAY_ELEM_AT: [{SPLIT: [end_field, ":"]}, 0]}}, 60]},
                            {TO_INT: {ARRAY_ELEM_AT: [{SPLIT: [end_field, ":"]}, 1]}},
                        ],
                    },
                    {
                        "$add": [
                            {MULTIPLY: [{TO_INT: {ARRAY_ELEM_AT: [{SPLIT: [start_field, ":"]}, 0]}}, 60]},
                            {TO_INT: {ARRAY_ELEM_AT: [{SPLIT: [start_field, ":"]}, 1]}},
                        ],
                    },
                ],
            },
            0,
        ],
    }


def build_status_count_field(status: str, status_field: str = "$status") -> dict:
    return {COND: [{"$eq": [status_field, status]}, 1, 0]}


def build_name_breakdown_pipeline(match_stage: dict, field: str, fallback: str) -> list[dict]:
    return [
        {MATCH: match_stage},
        {GROUP: {"_id": {IF_NULL: [field, fallback]}, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]


def build_class_name_breakdown_pipeline(match_stage: dict) -> list[dict]:
    """Class breakdown that treats null/missing/empty class_name as Unassigned."""
    return [
        {MATCH: match_stage},
        {GROUP: {"_id": {
            "$let": {
                "vars": {"class_name": {IF_NULL: ["$class_name", ""]}},
                "in": {COND: [{"$eq": ["$$class_name", ""]}, "Unassigned", "$$class_name"]},
            },
        }, "count": {"$sum": 1}}},
        {"$project": {"_id": 0, "name": "$_id", "count": 1}},
    ]
