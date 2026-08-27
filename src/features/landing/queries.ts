import { cacheLife } from "next/cache";

export async function getLandingCopyrightYear(): Promise<number> {
	"use cache";
	cacheLife({ revalidate: 86_400 });

	return new Date().getFullYear();
}

export async function fetchGitHubStats(): Promise<{
	stars: number;
	forks: number;
}> {
	"use cache";
	cacheLife({ revalidate: 3600 });

	try {
		const res = await fetch(
			"https://api.github.com/repos/felipegcoutinho/openmonetis",
		);
		if (!res.ok) return { stars: 200, forks: 60 };
		const data = await res.json();
		return {
			stars: data.stargazers_count as number,
			forks: data.forks_count as number,
		};
	} catch {
		return { stars: 200, forks: 60 };
	}
}
