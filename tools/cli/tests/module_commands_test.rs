use assert_cmd::Command;
use predicates::prelude::*;
use std::env;
use std::fs;
use std::path::PathBuf;
use tempfile::TempDir;

fn get_project_root() -> PathBuf {
    let mut path = env::current_exe().unwrap();
    path.pop();
    path.pop();
    path.pop();
    path
}

#[test]
fn test_module_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("module").arg("--help");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("Manage modules as crates"));
}

#[test]
fn test_module_scaffold_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("module").arg("scaffold").arg("--help");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("--manifest"))
        .stdout(predicate::str::contains("--dry-run"));
}

#[test]
fn test_module_validate_help() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("module").arg("validate").arg("--help");
    cmd.assert()
        .success()
        .stdout(predicate::str::contains("--manifest"))
        .stdout(predicate::str::contains("--json"));
}

#[test]
fn test_module_validate_valid_manifest() {
    let root = get_project_root();
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.current_dir(&root)
        .arg("module")
        .arg("validate")
        .arg("--manifest")
        .arg("specs/modules/content-pages.json");

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("validations passed"));
}

#[test]
fn test_module_validate_json_output() {
    let root = get_project_root();
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.current_dir(&root)
        .arg("module")
        .arg("validate")
        .arg("--manifest")
        .arg("specs/modules/content-pages.json")
        .arg("--json");

    cmd.assert().success().stdout(predicate::str::is_match(r#"\{\s*"valid"\s*:\s*true"#).unwrap());
}

#[test]
fn test_module_scaffold_dry_run() {
    let root = get_project_root();
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.current_dir(&root)
        .arg("module")
        .arg("scaffold")
        .arg("--manifest")
        .arg("specs/modules/content-pages.json")
        .arg("--dry-run");

    cmd.assert()
        .success()
        .stdout(predicate::str::contains("[DRY RUN]"))
        .stdout(predicate::str::contains("content-pages"))
        .stdout(predicate::str::contains("No files were written"));
}

#[test]
fn test_module_scaffold_idempotent() {
    let temp_dir = TempDir::new().unwrap();
    let temp_path = temp_dir.path();

    let original_dir = std::env::current_dir().unwrap();
    std::env::set_current_dir(temp_path).unwrap();

    fs::create_dir_all("specs/modules").unwrap();
    fs::copy(
        original_dir.join("specs/modules/content-pages.json"),
        "specs/modules/content-pages.json",
    )
    .unwrap();

    fs::copy(
        original_dir.join("specs/module_manifest.schema.json"),
        "specs/module_manifest.schema.json",
    )
    .unwrap();

    let mut cmd1 = Command::cargo_bin("atlas").unwrap();
    cmd1.arg("module")
        .arg("scaffold")
        .arg("--manifest")
        .arg("specs/modules/content-pages.json");
    cmd1.assert().success();

    let first_content = fs::read_to_string("crates/modules/content-pages/src/lib.rs").unwrap();

    let mut cmd2 = Command::cargo_bin("atlas").unwrap();
    cmd2.arg("module")
        .arg("scaffold")
        .arg("--manifest")
        .arg("specs/modules/content-pages.json");
    cmd2.assert().success();

    let second_content = fs::read_to_string("crates/modules/content-pages/src/lib.rs").unwrap();

    assert_eq!(first_content, second_content, "Scaffolding should be idempotent");

    std::env::set_current_dir(original_dir).unwrap();
}

#[test]
fn test_module_validate_missing_manifest() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("module")
        .arg("validate")
        .arg("--manifest")
        .arg("specs/modules/nonexistent.json");

    cmd.assert()
        .failure()
        .stdout(predicate::str::contains("not found"));
}

#[test]
fn test_module_scaffold_missing_manifest() {
    let mut cmd = Command::cargo_bin("atlas").unwrap();
    cmd.arg("module")
        .arg("scaffold")
        .arg("--manifest")
        .arg("specs/modules/nonexistent.json");

    cmd.assert()
        .failure()
        .stderr(predicate::str::contains("not found").or(predicate::str::contains("Manifest file not found")));
}
