export interface ComponentSummary {
	name: string;
	title: string;
	href: string;
	exampleCount: number;
}

export interface ComponentsIndexViewModel {
	pageHeading: string;
	components: ComponentSummary[];
}

export interface ComponentExample {
	name: string;
	html: string;
}

export interface ComponentDetailViewModel {
	pageHeading: string;
	componentName: string;
	backLinkUrl: string;
	backLinkText: string;
	examples: ComponentExample[];
}
