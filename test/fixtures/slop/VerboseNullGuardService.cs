using System;

public class VerboseNullGuardService
{
    public void Run(object a, object b, object c, object d)
    {
        if (a == null) throw new ArgumentNullException(nameof(a));
        if (b == null) throw new ArgumentNullException(nameof(b));
        if (c == null) throw new ArgumentNullException(nameof(c));
        if (d == null) throw new ArgumentNullException(nameof(d));
    }
}