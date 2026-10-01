from pathlib import Path

# requirements.txt is installed verbatim at deploy time (see .azure/pipelines/build.yml) -
# every dependency must be pinned with == so the deployed package is reproducible and
# can't silently drift to whatever happens to be latest on PyPI that day
REQUIREMENTS = Path(__file__).parent / "requirements.txt"


def test_all_requirements_are_pinned():
    lines = [line.strip() for line in REQUIREMENTS.read_text().splitlines()]
    dependencies = [line for line in lines if line and not line.startswith("#")]

    assert dependencies, "requirements.txt should not be empty"
    for dependency in dependencies:
        assert "==" in dependency, f"{dependency} is not pinned to an exact version"
