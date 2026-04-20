export interface Win32UiaTreeNode {
	name: string;
	controlType: string;
	automationId: string;
	className: string;
	bounds: { x: number; y: number; width: number; height: number };
	isEnabled: boolean;
	isOffscreen: boolean;
	children?: Win32UiaTreeNode[];
}
