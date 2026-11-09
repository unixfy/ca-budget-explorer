<script lang="ts">
	import type { PageProps } from './$types';
	import TreePage from '#lib/components/TreePage.svelte';
	let { data }: PageProps = $props();
</script>

<TreePage ds={data.ds} tree="bytype" trail={data.trail} detail={data.detail} />
