import axios from "axios";

export async function fetchPyPiPackage(pkgName: string): Promise<any> {
  const url = `https://pypi.org/pypi/${encodeURIComponent(pkgName)}/json`;
  const res = await axios.get(url, { timeout: 10000 });
  return res.data;
}
