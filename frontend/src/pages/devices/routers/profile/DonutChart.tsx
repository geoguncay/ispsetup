interface DonutChartProps {
  percentage: number
  title: string
  label1: string
  val1: string | number
  color1: string
  label2: string
  val2: string | number
  color2: string
  centerLabel: string
  centerSublabel: string
}

export function DonutChart({
  percentage,
  title,
  label1,
  val1,
  color1,
  label2,
  val2,
  color2,
  centerLabel,
  centerSublabel
}: DonutChartProps) {
  const radius = 38
  const circumference = 2 * Math.PI * radius
  const strokeDashoffset = circumference - (percentage / 100) * circumference

  return (
    <div className="bg-secondary/10 p-5 rounded-xl border border-border/40 space-y-4 flex flex-col items-center">
      <h4 className="text-sm font-semibold text-foreground self-start">{title}</h4>

      <div className="relative w-36 h-36 flex items-center justify-center">
        <svg className="w-full h-full transform -rotate-90" viewBox="0 0 100 100">
          {/* Base Circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={color2}
            strokeWidth="10"
          />
          {/* Main Circle */}
          <circle
            cx="50"
            cy="50"
            r={radius}
            fill="transparent"
            stroke={color1}
            strokeWidth="10"
            strokeDasharray={circumference}
            strokeDashoffset={strokeDashoffset}
            strokeLinecap="round"
            className="transition-all duration-500 ease-out"
          />
        </svg>

        {/* Center Text */}
        <div className="absolute flex flex-col items-center justify-center text-center">
          <span className="text-lg font-extrabold text-foreground">{centerLabel}</span>
          <span className="text-[9px] text-muted-foreground uppercase font-bold tracking-wider">{centerSublabel}</span>
        </div>
      </div>

      {/* Legend */}
      <div className="w-full grid grid-cols-2 gap-2 text-xs pt-2 border-t border-border/20">
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color1 }}></span>
            <span>{label1}</span>
          </div>
          <span className="text-xs font-bold text-foreground mt-0.5">{val1}</span>
        </div>
        <div className="flex flex-col items-center">
          <div className="flex items-center gap-1.5 text-muted-foreground text-[10px]">
            <span className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: color2 }}></span>
            <span>{label2}</span>
          </div>
          <span className="text-xs font-bold text-foreground mt-0.5">{val2}</span>
        </div>
      </div>
    </div>
  )
}
