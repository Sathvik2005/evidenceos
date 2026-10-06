import type { ButtonHTMLAttributes } from 'react'

export function Button({ variant = 'primary', className = '', type = 'button', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'quiet' }) {
  return <button type={type} className={`button button--${variant} ${className}`.trim()} {...rest} />
}
