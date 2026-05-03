using System;

public class EmptyCatchBlockService
{
    public void Run()
    {
        try
        {
            Work();
        }
        catch (Exception ex)
        {
        }
    }

    private void Work()
    {
    }
}