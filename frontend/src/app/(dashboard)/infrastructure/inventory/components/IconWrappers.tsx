import React from 'react'
import { paletteColor } from '@/utils/paletteColor'

export const PlayArrowIcon = (props: any) => <i className="ri-play-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const StopIcon = (props: any) => <i className="ri-stop-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const PauseIcon = (props: any) => <i className="ri-pause-fill" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const PowerSettingsNewIcon = (props: any) => <i className="ri-shut-down-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const MoveUpIcon = (props: any) => <i className="ri-upload-2-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const ContentCopyIcon = (props: any) => <i className="ri-file-copy-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const DescriptionIcon = (props: any) => <i className="ri-file-text-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const AddIcon = (props: any) => <i className="ri-add-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const CloseIcon = (props: any) => <i className="ri-close-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />
export const SaveIcon = (props: any) => <i className="ri-save-line" style={{ fontSize: props?.fontSize === 'small' ? 18 : 20, color: paletteColor(props?.sx?.color), ...props?.style }} />

