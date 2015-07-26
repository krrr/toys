from warnings import warn
from itertools import chain
import sys
import os
PY2 = sys.version_info[0] == 2
if PY2:
    from Cookie import Cookie
    from urllib import quote
else:
    from urllib.parse import quote
    from http.cookies import BaseCookie as Cookie


if PY2:
    iteritems = lambda d: d.iteritems()
else:
    iteritems = lambda d: iter(d.items())


def insert_into_body(html, target):
    no_case = target.lower()
    body_end = no_case.rfind(b'</body>')

    if body_end >= 0:
        return target[:body_end] + html + target[body_end:]
    elif no_case.startswith(b'<!doctype html>'):  # HTML5
        return target + html
    else:
        warn('Failed to insert profile result')
        return target


def query_str2dict(query):
    if not query:
        return {}
    pairs = query.split('&')
    try:
        return dict(map(lambda pair: pair.split('='), pairs))
    except ValueError:
        return {}


def dict2query_str(dic):
    return '&'.join('%s=%s' % (k, v) for k, v in iteritems(dic))


def shorten_filename(name):
    name = os.path.normpath(name)

    # if the file is absolute, try normalizing it relative to ./
    # to handle it as a project file
    if os.path.isabs(name):
        name = _shortest_relative_path(name, ['.'])

    if not os.path.isabs(name):  # it is a project file
        return os.path.join('.', name)
    else:  # otherwise, normalize other paths relative to library dirs
        return '<%s>' % _shortest_relative_path(name, _py_libs)


def _shortest_relative_path(name, paths):
    rel_paths = _relative_paths(name, paths)
    return min(chain(rel_paths, [name]), key=len)


def _relative_paths(value, paths):
    for i in paths:
        try:
            rel_path = os.path.relpath(value, i)
        except ValueError:
            # on Windows, relpath throws a ValueError for
            # paths with different drives
            continue
        if not rel_path.startswith('..'):
            yield rel_path


def get_python_lib():
    """Get path of libraries including standard and 3rd-party ones. For virtualenv,
    both virtual and real lib will be included."""
    py_ver = sys.version[:3]

    def lib_for_prefix(prefix):
        standard = os.path.join(prefix, 'lib', 'python' + py_ver)
        return [standard, os.path.join(standard, "site-packages")]

    if hasattr(sys, 'real_prefix'):  # virtualenv
        return lib_for_prefix(sys.real_prefix) + lib_for_prefix(sys.prefix)
    else:
        return lib_for_prefix(sys.prefix)


def reconstruct_path(environ):
    path = []
    path.append(quote(environ.get('SCRIPT_NAME', '')))
    path.append(quote(environ.get('PATH_INFO', '')))
    query = environ.get('QUERY_STRING')
    if query:
        path.append('?' + query)
    return ''.join(path)

_py_libs = get_python_lib()
