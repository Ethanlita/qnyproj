#!/usr/bin/env python3
"""Verify that openapi.template.yaml and backend/template.yaml describe the same API.

Checks performed:
- Every path defined in openapi.template.yaml exists in backend/template.yaml (and vice versa).
- For each path, the set of HTTP methods (excluding the 'parameters' key) matches.
- For each method, the security block and x-amazon-apigateway-integration block match exactly.

If mismatches are found the script prints details and exits with status 1.
"""
from __future__ import annotations

import sys
from pathlib import Path
from typing import Any, Dict, Tuple

import yaml
from yaml.loader import SafeLoader

REPO_ROOT = Path(__file__).resolve().parent.parent
OPENAPI_TEMPLATE_PATH = REPO_ROOT / "openapi.template.yaml"
BACKEND_TEMPLATE_PATH = REPO_ROOT / "backend" / "template.yaml"


class CfnLoader(SafeLoader):
    """YAML loader that gracefully ignores CloudFormation intrinsic tags."""


def _construct_cfn(loader: CfnLoader, tag_suffix: str, node: yaml.Node) -> Any:
    if isinstance(node, yaml.ScalarNode):
        return loader.construct_scalar(node)
    if isinstance(node, yaml.SequenceNode):
        return loader.construct_sequence(node)
    return loader.construct_mapping(node)


# Capture all !Intrinsic functions without enumerating each tag explicitly.
CfnLoader.add_multi_constructor("!", _construct_cfn)


def load_yaml(path: Path, loader=yaml.safe_load) -> Dict[str, Any]:
    try:
        with path.open("r", encoding="utf-8") as f:
            return loader(f)
    except FileNotFoundError:
        print(f"❌ File not found: {path}", file=sys.stderr)
        sys.exit(1)


def normalize_paths(raw_paths: Dict[str, Any]) -> Dict[str, Dict[str, Dict[str, Any]]]:
    normalized: Dict[str, Dict[str, Dict[str, Any]]] = {}
    for path, methods in raw_paths.items():
        method_map: Dict[str, Dict[str, Any]] = {}
        for method, body in methods.items():
            if method.lower() == "parameters":
                continue
            method_map[method.lower()] = body or {}
        normalized[path] = method_map
    return normalized


def compare_paths(template_paths: Dict[str, Dict[str, Any]], backend_paths: Dict[str, Dict[str, Any]]) -> Tuple[bool, str]:
    errors = []

    template_keys = set(template_paths.keys())
    backend_keys = set(backend_paths.keys())

    missing_in_backend = sorted(template_keys - backend_keys)
    extra_in_backend = sorted(backend_keys - template_keys)

    if missing_in_backend:
        errors.append("Paths missing in backend/template.yaml: " + ", ".join(missing_in_backend))
    if extra_in_backend:
        errors.append("Extra paths present only in backend/template.yaml: " + ", ".join(extra_in_backend))

    common_paths = template_keys & backend_keys
    for path in sorted(common_paths):
        template_methods = template_paths[path]
        backend_methods = backend_paths[path]
        if set(template_methods) != set(backend_methods):
            errors.append(
                f"Method mismatch for {path}: template={sorted(template_methods)} backend={sorted(backend_methods)}"
            )
            continue

        for method in template_methods:
            tmpl = template_methods[method]
            back = backend_methods[method]
            if tmpl.get("security") != back.get("security"):
                errors.append(
                    f"Security mismatch at {path} {method.upper()}: template={tmpl.get('security')} backend={back.get('security')}"
                )
            if tmpl.get("x-amazon-apigateway-integration") != back.get("x-amazon-apigateway-integration"):
                errors.append(f"Integration mismatch at {path} {method.upper()}")

    if errors:
        return False, "\n".join(errors)
    return True, "All OpenAPI definitions are in sync."


def main() -> int:
    if not OPENAPI_TEMPLATE_PATH.exists():
        print(f"❌ openapi.template.yaml not found at {OPENAPI_TEMPLATE_PATH}", file=sys.stderr)
        return 1
    if not BACKEND_TEMPLATE_PATH.exists():
        print(f"❌ backend/template.yaml not found at {BACKEND_TEMPLATE_PATH}", file=sys.stderr)
        return 1

    openapi_template = load_yaml(OPENAPI_TEMPLATE_PATH)
    backend_template = load_yaml(BACKEND_TEMPLATE_PATH, loader=lambda f: yaml.load(f, Loader=CfnLoader))

    template_paths = normalize_paths(openapi_template.get("paths", {}))
    backend_paths = normalize_paths(
        backend_template["Resources"]["MyApiGateway"]["Properties"]["DefinitionBody"]["paths"]
    )

    ok, message = compare_paths(template_paths, backend_paths)
    if ok:
        print(f"✅ {message}")
        return 0
    print(f"❌ OpenAPI mismatch detected:\n{message}", file=sys.stderr)
    return 1


if __name__ == "__main__":
    sys.exit(main())
