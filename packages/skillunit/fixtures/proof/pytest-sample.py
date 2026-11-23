# The tests behind pytest.xml (pytest 9.2). To regenerate, copy this file as test_sample.py into
# an empty folder and run there:
#   pytest --junitxml=pytest.xml -o junit_suite_name=pytest -p no:cacheprovider test_sample.py
# then set `hostname` to localhost and replace the folder's path with /project.
# A Python test name cannot hold `[skill:<id>]`; a parametrize id can, and pytest puts it in brackets.
import pytest


def skill(*ids):
    """One run of the test, with the tags of the units it proves as its id."""
    return pytest.mark.parametrize("_skill", [None], ids=["] [".join(f"skill:{i}" for i in ids)])


class TestRetries:
    @skill("retry-defaults")
    def test_reads_the_defaults(self, _skill):
        assert 1 == 1

    @skill("retry-network", "retry-5xx")
    def test_covers_two_units(self, _skill):
        assert 1 == 1

    @skill("retry-fails")
    def test_fails(self, _skill):
        assert 1 == 2

    @pytest.mark.skip(reason="not now")
    @skill("retry-skipped")
    def test_is_skipped(self, _skill):
        pass

    @skill("retry-throws")
    def test_throws(self, _skill):
        raise RuntimeError("boom & <done>")


@pytest.fixture
def broken():
    raise RuntimeError("fixture failed")


@skill("retry-setup-error")
def test_setup_error(broken, _skill):
    pass


@pytest.mark.parametrize("title", ['"quotes" & <angle>'])
def test_title_with_entities(title):
    assert title


def test_has_no_tag():
    assert True
